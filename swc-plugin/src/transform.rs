use std::collections::{BTreeMap, HashMap, HashSet};

use swc_core::atoms::Atom;
use swc_core::common::errors::HANDLER;
use swc_core::common::util::take::Take;
use swc_core::common::{Spanned, DUMMY_SP};
use swc_core::ecma::ast::{
    Bool, CallExpr, Callee, Decl, Expr, Ident, ImportDecl, ImportSpecifier, Lit, Module,
    ModuleDecl, ModuleExportName, ModuleItem, ObjectPatProp, Pat, Program, Prop, PropName,
    PropOrSpread, Stmt, UnaryOp, VarDecl, VarDeclKind, VarDeclarator,
};
use swc_core::ecma::visit::{
    noop_visit_mut_type, noop_visit_type, Visit, VisitMut, VisitMutWith, VisitWith,
};

use crate::Config;

const MODULE_SPECIFIER: &str = "build-conditions";
const SWITCH_HELPER: &str = "switchBuildCondition";
const IS_HELPER: &str = "isBuildConditions";
const DEFAULT_KEY: &str = "default";
const REQUIRE_ATOM: &str = "require";

#[derive(Debug, Clone, Copy, PartialEq)]
enum Helper {
    Switch,
    Is,
}

/// Status of a condition value relative to the config
#[derive(Debug, Clone, Copy, PartialEq)]
enum ConditionState {
    /// The value matches the fixed value of its group
    ActiveFixed,
    /// The group is fixed to another value — the condition is known inactive
    InactiveFixed,
    /// The group is not fixed (null) — activity is known only at runtime
    Runtime,
}

/// Result of statically evaluating an isBuildConditions call
#[derive(Debug, Clone, Copy, PartialEq)]
enum IsEval {
    Known(bool),
    /// Some conditions come from non-fixed groups — the call stays in runtime
    Runtime,
}

/// Local names of the package helpers available in scope
#[derive(Debug, Default)]
struct Scope {
    switch_local: Option<Atom>,
    is_local: Option<Atom>,
    namespace_local: Option<Atom>,
}

#[derive(Debug)]
pub struct TransformVisitor {
    /// Condition value → its group name
    value_to_group: HashMap<String, String>,
    /// Group → fixed value (None — the group is switched at runtime)
    conditions: BTreeMap<String, Option<String>>,

    scopes: Vec<Scope>,
    is_es_module: bool,

    /// Whether at least one transformation was performed in the module
    did_transform: bool,
    /// Identifiers from removed (dead) branches — import removal candidates
    discarded_idents: HashSet<Atom>,
}

impl TransformVisitor {
    pub fn new(config: Config) -> TransformVisitor {
        let value_to_group = config.validate().unwrap_or_else(|error| panic!("{error}"));

        TransformVisitor {
            value_to_group,
            conditions: config.conditions,
            scopes: vec![],
            is_es_module: false,
            did_transform: false,
            discarded_idents: HashSet::new(),
        }
    }

    fn visit_mut_scoped_stmts(&mut self, stmts: &mut Vec<Stmt>) {
        if self.is_es_module {
            stmts.visit_mut_with(self);

            return;
        }

        // In CommonJS require can appear inside functions — open a scope
        self.scopes.push(Scope::default());
        stmts.visit_mut_with(self);
        self.scopes.pop();
    }

    fn current_scope(&mut self) -> &mut Scope {
        self.scopes
            .last_mut()
            .expect("scopes should not be empty during traversal")
    }

    fn resolve_local(&self, sym: &Atom) -> Option<Helper> {
        for scope in self.scopes.iter().rev() {
            if scope.switch_local.as_ref() == Some(sym) {
                return Some(Helper::Switch);
            }
            if scope.is_local.as_ref() == Some(sym) {
                return Some(Helper::Is);
            }
        }

        None
    }

    fn is_namespace(&self, sym: &Atom) -> bool {
        self.scopes
            .iter()
            .any(|scope| scope.namespace_local.as_ref() == Some(sym))
    }

    /// Determines whether the callee is a call to one of the package helpers.
    /// Supports a direct identifier, `ns.helper` and `(0, ns.helper)`.
    fn resolve_helper(&self, callee: &Expr) -> Option<Helper> {
        if let Expr::Paren(paren) = callee {
            if let Some(seq) = paren.expr.as_seq() {
                if let Some(last) = seq.exprs.last() {
                    return self.resolve_helper(last);
                }
            }
        }

        match callee {
            Expr::Ident(ident) => self.resolve_local(&ident.sym),
            Expr::Member(member) => {
                let object = member.obj.as_ident()?;

                if !self.is_namespace(&object.sym) {
                    return None;
                }

                let prop = member.prop.as_ident()?;

                match prop.sym.as_str() {
                    SWITCH_HELPER => Some(Helper::Switch),
                    IS_HELPER => Some(Helper::Is),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Callee of the call, if it is an isBuildConditions call
    fn as_is_call<'a>(&self, expr: &'a Expr) -> Option<&'a CallExpr> {
        let Expr::Call(call) = expr else {
            return None;
        };
        let Callee::Expr(callee) = &call.callee else {
            return None;
        };

        matches!(self.resolve_helper(callee), Some(Helper::Is)).then_some(call)
    }

    /// Registers a helper by its export name from the package
    fn register_export_name(&mut self, export_name: &str, local: &Atom) {
        match export_name {
            SWITCH_HELPER => self.current_scope().switch_local = Some(local.clone()),
            IS_HELPER => self.current_scope().is_local = Some(local.clone()),
            _ => {}
        }
    }

    fn is_require_from_module(call: &CallExpr) -> bool {
        let is_require = match &call.callee {
            Callee::Expr(expr) => {
                matches!(&**expr, Expr::Ident(ident) if ident.sym.as_str() == REQUIRE_ATOM)
            }
            _ => false,
        };

        if !is_require {
            return false;
        }

        call.args.first().is_some_and(|arg| {
            matches!(
                &*arg.expr,
                Expr::Lit(Lit::Str(str)) if str.value.as_str().is_some_and(|value| value == MODULE_SPECIFIER)
            )
        })
    }

    /// Status of a condition value. None — the value is not found in any group
    fn resolve_condition(&self, value: &str) -> Option<ConditionState> {
        let group = self.value_to_group.get(value)?;

        Some(match &self.conditions[group] {
            Some(chosen) if chosen == value => ConditionState::ActiveFixed,
            Some(_) => ConditionState::InactiveFixed,
            None => ConditionState::Runtime,
        })
    }

    /// Remembers the identifiers of a discarded node — after the module
    /// traversal their imports are removed if no other usages remain
    fn discard<N: VisitWith<IdentCollector>>(&mut self, node: &N) {
        let mut collector = IdentCollector::default();
        node.visit_with(&mut collector);
        self.discarded_idents.extend(collector.idents);
    }

    /// Extracts condition values from an isBuildConditions argument.
    /// Err(span) — the argument is neither a string literal nor an array of them
    fn extract_is_values(call: &CallExpr) -> Result<Vec<&str>, swc_core::common::Span> {
        let Some(arg) = call.args.first() else {
            return Err(call.span);
        };

        if arg.spread.is_some() {
            return Err(arg.expr.span());
        }

        let mut values = vec![];

        match &*arg.expr {
            Expr::Lit(Lit::Str(str)) => {
                values.push(str.value.as_str().ok_or(arg.expr.span())?);
            }
            Expr::Array(array) => {
                for element in array.elems.iter() {
                    let Some(element) = element else {
                        return Err(arg.expr.span());
                    };

                    if element.spread.is_some() {
                        return Err(element.expr.span());
                    }

                    match &*element.expr {
                        Expr::Lit(Lit::Str(str)) => {
                            values.push(str.value.as_str().ok_or(element.expr.span())?);
                        }
                        other => return Err(other.span()),
                    }
                }
            }
            other => return Err(other.span()),
        }

        Ok(values)
    }

    /// Static evaluation of isBuildConditions values.
    /// Err — one of the values is unknown (absent from every group of the config)
    fn eval_is_values(&self, values: &[&str]) -> Result<IsEval, String> {
        let mut has_runtime = false;

        for &value in values {
            match self.resolve_condition(value) {
                None => return Err(value.to_string()),
                // A condition from a fixed group did not match — the whole
                // call is statically false, even if other conditions are runtime
                Some(ConditionState::InactiveFixed) => return Ok(IsEval::Known(false)),
                Some(ConditionState::Runtime) => has_runtime = true,
                Some(ConditionState::ActiveFixed) => {}
            }
        }

        if has_runtime {
            Ok(IsEval::Runtime)
        } else {
            Ok(IsEval::Known(true))
        }
    }

    fn unknown_value_error(&self, span: swc_core::common::Span, value: &str) {
        let groups = self
            .conditions
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(", ");

        HANDLER.with(|handler| {
            handler.span_err(
                span,
                &format!(
                    "build-conditions: condition value '{value}' is not found in any group of the config (groups: {groups})"
                ),
            )
        });
    }

    /// Transformation of `isBuildConditions(condition | [conditions])`. Returns
    /// a boolean literal or `None` if the call must stay in runtime
    fn transform_is(&mut self, call: &CallExpr) -> Option<Expr> {
        let values = match Self::extract_is_values(call) {
            Ok(values) => values,
            Err(span) => {
                HANDLER.with(|handler| {
                    handler.span_err(
                        span,
                        "build-conditions: isBuildConditions accepts only a string literal or an array of string literals; use getBuildConditions for dynamic checks",
                    )
                });

                return None;
            }
        };

        let result = match self.eval_is_values(&values) {
            Ok(IsEval::Known(result)) => result,
            Ok(IsEval::Runtime) => return None,
            Err(value) => {
                self.unknown_value_error(call.span, &value);

                return None;
            }
        };

        self.did_transform = true;

        Some(Expr::Lit(Lit::Bool(Bool {
            span: DUMMY_SP,
            value: result,
        })))
    }

    /// Key of a condition map property: `key: value` or shorthand `{ key }`
    fn prop_key(prop: &PropOrSpread) -> Option<Atom> {
        let PropOrSpread::Prop(prop) = prop else {
            return None;
        };

        match &**prop {
            Prop::KeyValue(key_value) => match &key_value.key {
                PropName::Ident(ident) => Some(ident.sym.clone()),
                PropName::Str(str) => str.value.as_str().map(Atom::new),
                _ => None,
            },
            Prop::Shorthand(ident) => Some(ident.sym.clone()),
            _ => None,
        }
    }

    /// Transformation of `switchBuildCondition(map)`. Returns the replacement
    /// expression or `None` if the call must stay in runtime
    fn transform_switch(&mut self, call: &mut CallExpr) -> Option<Expr> {
        let call_span = call.span;

        let Some(arg) = call.args.first_mut() else {
            return None;
        };

        let arg_span = arg.expr.span();
        let object = if arg.spread.is_none() { arg.expr.as_mut_object() } else { None };

        let Some(object) = object else {
            HANDLER.with(|handler| {
                handler.span_err(
                    arg_span,
                    "build-conditions: switchBuildCondition accepts only an object literal with condition branches",
                )
            });

            return None;
        };

        let mut keys: Vec<Atom> = Vec::with_capacity(object.props.len());

        for prop in object.props.iter() {
            match Self::prop_key(prop) {
                Some(key) => keys.push(key),
                None => {
                    HANDLER.with(|handler| {
                        handler.span_err(
                            prop.span(),
                            "build-conditions: switchBuildCondition supports only properties of the form `condition: value`",
                        )
                    });

                    return None;
                }
            }
        }

        // Resolve the group of every branch; the keys (except default) must
        // belong to a single group — same as in the types (SingleGroup)
        let mut map_group: Option<&String> = None;

        for key in &keys {
            if key.as_str() == DEFAULT_KEY {
                continue;
            }

            let Some(group) = self.value_to_group.get(key.as_str()) else {
                self.unknown_value_error(call_span, key.as_str());

                return None;
            };

            match map_group {
                None => map_group = Some(group),
                Some(existing) if existing == group => {}
                Some(existing) => {
                    HANDLER.with(|handler| {
                        handler.span_err(
                            call_span,
                            &format!(
                                "build-conditions: switchBuildCondition branches belong to different condition groups ('{existing}' and '{group}')"
                            ),
                        )
                    });

                    return None;
                }
            }
        }

        // The map's group is not fixed — the call stays in runtime
        if let Some(group) = map_group {
            if self.conditions[group].is_none() {
                return None;
            }
        }

        let winner_index = keys
            .iter()
            .position(|key| {
                key.as_str() != DEFAULT_KEY
                    && self.resolve_condition(key.as_str()) == Some(ConditionState::ActiveFixed)
            })
            .or_else(|| keys.iter().position(|key| key.as_str() == DEFAULT_KEY));

        let Some(winner_index) = winner_index else {
            HANDLER.with(|handler| {
                handler.span_err(
                    call_span,
                    "build-conditions: no switchBuildCondition branch matches the fixed conditions and there is no default branch",
                )
            });

            return None;
        };

        // The winner's value is taken by ownership (the whole call will be
        // replaced by it); dead-branch values are not cloned — only their
        // identifiers are collected for import cleanup
        let mut winner: Option<Expr> = None;

        for (index, prop) in object.props.iter_mut().enumerate() {
            let PropOrSpread::Prop(prop) = prop else {
                continue;
            };

            match &mut **prop {
                Prop::KeyValue(key_value) => {
                    if index == winner_index {
                        winner = Some(*key_value.value.take());
                    } else {
                        self.discard(&*key_value.value);
                    }
                }
                Prop::Shorthand(ident) => {
                    if index == winner_index {
                        winner = Some(Expr::Ident(ident.clone()));
                    } else {
                        self.discard(&*ident);
                    }
                }
                _ => {}
            }
        }

        self.did_transform = true;

        winner
    }

    /// Static evaluation of an if-statement test: a direct isBuildConditions
    /// call or its negation (incl. `!!`). No errors are emitted here — when
    /// the evaluation fails, the call goes through the regular expression
    /// transformation path
    fn try_eval_if_test(&self, test: &Expr) -> Option<bool> {
        if let Expr::Unary(unary) = test {
            if unary.op == UnaryOp::Bang {
                return self.try_eval_if_test(&unary.arg).map(|value| !value);
            }

            return None;
        }

        let call = self.as_is_call(test)?;
        let values = Self::extract_is_values(call).ok()?;

        match self.eval_is_values(&values).ok()? {
            IsEval::Known(value) => Some(value),
            IsEval::Runtime => None,
        }
    }

    /// Removes dead top-level declarations: non-exported `function` and
    /// `const`/`let`/`var` with a simple name that were referenced from a dead
    /// branch, are not used anywhere else in the module and have a provably
    /// pure initializer. The identifiers of a removed declaration become new
    /// candidates — repeat until a fixpoint. The occurrence counter is built
    /// once and decremented by the identifiers of removed nodes
    fn cleanup_declarations(&mut self, module: &mut Module) {
        if !self.has_dead_candidates(module) {
            return;
        }

        let mut counts = count_idents(&module.body);

        loop {
            let mut removed = false;

            module.body.retain_mut(|item| {
                let ModuleItem::Stmt(Stmt::Decl(decl)) = item else {
                    return true;
                };

                match decl {
                    Decl::Fn(fn_decl) => {
                        if !self.is_dead(&fn_decl.ident.sym, &counts) {
                            return true;
                        }

                        self.discard_counted(&*fn_decl.function, &mut counts);
                        removed = true;

                        false
                    }
                    Decl::Var(var) => {
                        if var.declare {
                            return true;
                        }

                        var.decls.retain(|declarator| {
                            let Pat::Ident(name) = &declarator.name else {
                                return true;
                            };

                            if !self.is_dead(&name.id.sym, &counts) {
                                return true;
                            }

                            if let Some(init) = &declarator.init {
                                if !is_pure_expr(init) {
                                    return true;
                                }

                                self.discard_counted(&**init, &mut counts);
                            }

                            removed = true;

                            false
                        });

                        !var.decls.is_empty()
                    }
                    _ => true,
                }
            });

            if !removed {
                break;
            }
        }
    }

    /// Whether any top-level declaration has a name from a dead branch
    fn has_dead_candidates(&self, module: &Module) -> bool {
        module.body.iter().any(|item| {
            let ModuleItem::Stmt(Stmt::Decl(decl)) = item else {
                return false;
            };

            match decl {
                Decl::Fn(fn_decl) => self.discarded_idents.contains(&fn_decl.ident.sym),
                Decl::Var(var) => var.decls.iter().any(|declarator| {
                    matches!(
                        &declarator.name,
                        Pat::Ident(name) if self.discarded_idents.contains(&name.id.sym)
                    )
                }),
                _ => false,
            }
        })
    }

    /// The name was in a dead branch and its only occurrence in the module is
    /// the declaration itself
    fn is_dead(&self, sym: &Atom, counts: &HashMap<Atom, usize>) -> bool {
        self.discarded_idents.contains(sym) && counts.get(sym).copied() == Some(1)
    }

    /// Remembers the identifiers of a removed node as candidates and subtracts
    /// them from the module occurrence counter
    fn discard_counted<N: VisitWith<IdentCounter>>(
        &mut self,
        node: &N,
        counts: &mut HashMap<Atom, usize>,
    ) {
        let mut counter = IdentCounter::default();
        node.visit_with(&mut counter);

        for (sym, count) in counter.counts {
            if let Some(total) = counts.get_mut(&sym) {
                *total = total.saturating_sub(count);
            }

            self.discarded_idents.insert(sym);
        }
    }

    /// Removes imports that became unused: package helpers with no remaining
    /// calls and identifiers from dead branches
    fn cleanup_imports(&mut self, module: &mut Module) {
        let mut usage = IdentCollector::default();

        for item in module.body.iter() {
            if matches!(item, ModuleItem::ModuleDecl(ModuleDecl::Import(_))) {
                continue;
            }

            item.visit_with(&mut usage);
        }

        let used = usage.idents;
        let discarded = &self.discarded_idents;

        module.body.retain_mut(|item| {
            let ModuleItem::ModuleDecl(ModuleDecl::Import(import)) = item else {
                return true;
            };

            if import.specifiers.is_empty() {
                // Side-effect imports (`import './styles.css'`) are kept as-is
                return true;
            }

            let is_module_import = import.src.value.eq(MODULE_SPECIFIER);

            import.specifiers.retain(|specifier| {
                let local = match specifier {
                    ImportSpecifier::Named(named) => &named.local,
                    ImportSpecifier::Default(default) => &default.local,
                    ImportSpecifier::Namespace(namespace) => &namespace.local,
                    #[cfg(swc_ast_unknown)]
                    _ => panic!("Unknown import specifier"),
                };

                if used.contains(&local.sym) {
                    return true;
                }

                if is_module_import {
                    // From the package import, only the transform helpers and
                    // the namespace are removed: runtime helpers
                    // (setBuildConditions etc.) are kept
                    match specifier {
                        ImportSpecifier::Named(named) => {
                            let export_name = match &named.imported {
                                Some(ModuleExportName::Ident(imported)) => imported.sym.as_str(),
                                Some(ModuleExportName::Str(_)) => return true,
                                None => named.local.sym.as_str(),
                                #[cfg(swc_ast_unknown)]
                                Some(_) => panic!("Unknown module export name"),
                            };

                            !matches!(export_name, SWITCH_HELPER | IS_HELPER)
                        }
                        ImportSpecifier::Namespace(_) => false,
                        ImportSpecifier::Default(_) => true,
                        #[cfg(swc_ast_unknown)]
                        _ => panic!("Unknown import specifier"),
                    }
                } else {
                    // From other imports, only values from dead branches are removed
                    !discarded.contains(&local.sym)
                }
            });

            !import.specifiers.is_empty()
        });
    }
}

impl VisitMut for TransformVisitor {
    noop_visit_mut_type!();

    fn visit_mut_program(&mut self, node: &mut Program) {
        self.is_es_module = node.is_module();

        // Fast path: in Module programs a reference to the package — an import
        // or a top-level `require` — is always at the top level; without one
        // the tree traversal is unnecessary. Exotic cases like requiring the
        // package only inside functions of a Module program are not
        // transformed but keep working: the helpers have runtime
        // implementations. Script (CommonJS) programs are always traversed —
        // there require can appear in any scope.
        if let Program::Module(module) = &*node {
            if !module_references_package(module) {
                return;
            }
        }

        self.scopes.push(Scope::default());

        node.visit_mut_children_with(self);

        self.scopes.pop();

        if self.did_transform {
            if let Program::Module(module) = node {
                self.cleanup_declarations(module);
                self.cleanup_imports(module);
            }
        }
    }

    fn visit_mut_import_decl(&mut self, node: &mut ImportDecl) {
        if !node.src.value.eq(MODULE_SPECIFIER) {
            return;
        }

        for specifier in node.specifiers.iter() {
            match specifier {
                ImportSpecifier::Namespace(namespace) => {
                    self.current_scope().namespace_local = Some(namespace.local.sym.clone());
                }
                ImportSpecifier::Named(named) => {
                    let export_name = match &named.imported {
                        Some(ModuleExportName::Ident(imported)) => &imported.sym,
                        Some(ModuleExportName::Str(_)) => {
                            HANDLER.with(|handler| {
                                handler.span_err(
                                    node.span,
                                    "build-conditions: string literals in imports are not supported",
                                )
                            });

                            continue;
                        }
                        None => &named.local.sym,
                        #[cfg(swc_ast_unknown)]
                        Some(_) => panic!("Unknown module export name"),
                    };

                    self.register_export_name(export_name.as_str(), &named.local.sym);
                }
                ImportSpecifier::Default(_) => {}
                #[cfg(swc_ast_unknown)]
                _ => panic!("Unknown import specifier"),
            }
        }
    }

    fn visit_mut_var_declarator(&mut self, node: &mut VarDeclarator) {
        node.visit_mut_children_with(self);

        let Some(init) = &node.init else {
            return;
        };
        let Expr::Call(call) = &**init else {
            return;
        };

        if !Self::is_require_from_module(call) {
            return;
        }

        match &node.name {
            Pat::Ident(ident) => {
                self.current_scope().namespace_local = Some(ident.id.sym.clone());
            }
            Pat::Object(object) => {
                for prop in object.props.iter() {
                    match prop {
                        ObjectPatProp::Assign(assign) => {
                            self.register_export_name(assign.key.sym.as_str(), &assign.key.sym);
                        }
                        ObjectPatProp::KeyValue(key_value) => {
                            let PropName::Ident(key) = &key_value.key else {
                                continue;
                            };
                            let Some(local) = key_value.value.as_ident() else {
                                continue;
                            };

                            self.register_export_name(key.sym.as_str(), &local.id.sym);
                        }
                        ObjectPatProp::Rest(_) => {}
                        #[cfg(swc_ast_unknown)]
                        _ => panic!("Unknown object pattern property"),
                    }
                }
            }
            _ => {}
        }
    }

    fn visit_mut_block_stmt(&mut self, node: &mut swc_core::ecma::ast::BlockStmt) {
        self.visit_mut_scoped_stmts(&mut node.stmts);
    }

    fn visit_mut_function_body(&mut self, node: &mut swc_core::ecma::ast::FunctionBody) {
        self.visit_mut_scoped_stmts(&mut node.stmts);
    }

    fn visit_mut_stmt(&mut self, stmt: &mut Stmt) {
        // Dead `if (isBuildConditions(...))` branches are removed before
        // visiting children: once the call is replaced by a literal, it is
        // indistinguishable from a hand-written one
        if let Stmt::If(if_stmt) = stmt {
            if let Some(test_result) = self.try_eval_if_test(&if_stmt.test) {
                let dropped: Option<&Stmt> = if test_result {
                    if_stmt.alt.as_deref()
                } else {
                    Some(&if_stmt.cons)
                };

                // `var` from a removed branch hoists to the function level —
                // such a branch is kept; the bundler and the minifier will
                // finish off the `if (false)`
                let hoists_var = dropped.is_some_and(has_hoisted_var);

                if !hoists_var {
                    if let Some(dropped) = dropped {
                        self.discard(dropped);
                    }

                    // Branches are taken by ownership — the whole if is rewritten
                    let taken: Option<Stmt> = if test_result {
                        Some(*if_stmt.cons.take())
                    } else {
                        if_stmt.alt.take().map(|alt| *alt)
                    };

                    self.did_transform = true;

                    match taken {
                        // The branch stays a block — the let/const scope is preserved
                        Some(taken) => {
                            *stmt = taken;
                            // The surviving branch is traversed again: it may
                            // contain nested helper calls and else-if chains
                            self.visit_mut_stmt(stmt);
                        }
                        None => {
                            *stmt = Stmt::Empty(swc_core::ecma::ast::EmptyStmt { span: DUMMY_SP });
                        }
                    }

                    return;
                }
            }
        }

        stmt.visit_mut_children_with(self);
    }

    fn visit_mut_stmts(&mut self, stmts: &mut Vec<Stmt>) {
        stmts.visit_mut_children_with(self);

        stmts.retain(|stmt| !matches!(stmt, Stmt::Empty(..)));
    }

    fn visit_mut_module_items(&mut self, items: &mut Vec<ModuleItem>) {
        items.visit_mut_children_with(self);

        items.retain(|item| !matches!(item, ModuleItem::Stmt(Stmt::Empty(..))));
    }

    fn visit_mut_expr(&mut self, node: &mut Expr) {
        node.visit_mut_children_with(self);

        let Expr::Call(call) = node else {
            return;
        };
        let Callee::Expr(callee) = &call.callee else {
            return;
        };

        let replacement = match self.resolve_helper(callee) {
            Some(Helper::Switch) => self.transform_switch(call),
            Some(Helper::Is) => self.transform_is(call),
            None => None,
        };

        if let Some(replacement) = replacement {
            *node = replacement;
        }
    }
}

/// Whether the node contains `var` declarations that hoist out of the block
/// (nested functions are not descended into — they have their own scope)
fn has_hoisted_var(stmt: &Stmt) -> bool {
    let mut finder = HoistedVarFinder::default();
    stmt.visit_with(&mut finder);
    finder.found
}

#[derive(Default)]
struct HoistedVarFinder {
    found: bool,
}

impl Visit for HoistedVarFinder {
    noop_visit_type!();

    fn visit_var_decl(&mut self, node: &VarDecl) {
        if node.kind == VarDeclKind::Var {
            self.found = true;
        }

        node.visit_children_with(self);
    }

    fn visit_function(&mut self, _: &swc_core::ecma::ast::Function) {}

    fn visit_arrow_expr(&mut self, _: &swc_core::ecma::ast::ArrowExpr) {}
}

/// Collects the identifiers of a subtree: of dead branches during the
/// transformation and of the whole module (outside imports) during import cleanup
#[derive(Default)]
struct IdentCollector {
    idents: HashSet<Atom>,
}

impl Visit for IdentCollector {
    noop_visit_type!();

    fn visit_ident(&mut self, ident: &Ident) {
        self.idents.insert(ident.sym.clone());
    }
}

/// Occurrence count of every identifier in the module outside imports;
/// the declaration's own name counts as an occurrence too
fn count_idents(items: &[ModuleItem]) -> HashMap<Atom, usize> {
    let mut counter = IdentCounter::default();

    for item in items {
        if matches!(item, ModuleItem::ModuleDecl(ModuleDecl::Import(_))) {
            continue;
        }

        item.visit_with(&mut counter);
    }

    counter.counts
}

#[derive(Default)]
struct IdentCounter {
    counts: HashMap<Atom, usize>,
}

impl Visit for IdentCounter {
    noop_visit_type!();

    fn visit_ident(&mut self, ident: &Ident) {
        *self.counts.entry(ident.sym.clone()).or_default() += 1;
    }
}

/// An expression without side effects on evaluation: functions, literals,
/// identifiers and object/array literals made of such values
fn is_pure_expr(expr: &Expr) -> bool {
    match expr {
        Expr::Arrow(_) | Expr::Fn(_) | Expr::Lit(_) | Expr::Ident(_) => true,
        Expr::Tpl(tpl) => tpl.exprs.is_empty(),
        Expr::Paren(paren) => is_pure_expr(&paren.expr),
        Expr::TsAs(ts) => is_pure_expr(&ts.expr),
        Expr::TsSatisfies(ts) => is_pure_expr(&ts.expr),
        Expr::TsTypeAssertion(ts) => is_pure_expr(&ts.expr),
        Expr::TsConstAssertion(ts) => is_pure_expr(&ts.expr),
        Expr::TsNonNull(ts) => is_pure_expr(&ts.expr),
        Expr::TsInstantiation(ts) => is_pure_expr(&ts.expr),
        Expr::Array(array) => array.elems.iter().all(|elem| match elem {
            None => true,
            Some(elem) => elem.spread.is_none() && is_pure_expr(&elem.expr),
        }),
        Expr::Object(object) => object.props.iter().all(|prop| match prop {
            PropOrSpread::Spread(_) => false,
            PropOrSpread::Prop(prop) => match &**prop {
                Prop::Shorthand(_) => true,
                Prop::KeyValue(key_value) => {
                    !matches!(key_value.key, PropName::Computed(_))
                        && is_pure_expr(&key_value.value)
                }
                Prop::Method(method) => !matches!(method.key, PropName::Computed(_)),
                Prop::Getter(getter) => !matches!(getter.key, PropName::Computed(_)),
                Prop::Setter(setter) => !matches!(setter.key, PropName::Computed(_)),
                _ => false,
            },
            #[cfg(swc_ast_unknown)]
            _ => false,
        }),
        _ => false,
    }
}

/// Whether the module references the package at the top level: an import with
/// its specifier or a var declaration with a `require` of the package in the
/// initializer
fn module_references_package(module: &Module) -> bool {
    module.body.iter().any(|item| match item {
        ModuleItem::ModuleDecl(ModuleDecl::Import(import)) => {
            import.src.value.eq(MODULE_SPECIFIER)
        }
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(var))) => var.decls.iter().any(|decl| {
            matches!(
                decl.init.as_deref(),
                Some(Expr::Call(call)) if TransformVisitor::is_require_from_module(call)
            )
        }),
        _ => false,
    })
}
