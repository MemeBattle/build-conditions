//! Performance measurements of the transformation on synthetic modules: `cargo bench`.
//!
//! Only the visitor itself is measured (native build); absolute numbers in
//! the wasm runtime will differ, but the relative dynamics are the same.
//! The scenarios cover the hot paths:
//! - `no_package_reference` — a module without a reference to the package
//!   (early exit, the typical file in a build);
//! - `switch_large_branches` — switchBuildCondition with large branches
//!   (the winner is taken by ownership instead of cloning all branches);
//! - `nested_known_ifs` — nested statically known ifs (the branch is taken
//!   by ownership instead of a deep clone);
//! - `cjs_script_requires` — a CommonJS script (full traversal with a scope
//!   per block);
//! - `switch_dead_declarations` — switchBuildCondition whose branches reference
//!   local declarations (cascading cleanup of declarations and imports).

use std::fmt::Write as _;

use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use swc_core::common::sync::Lrc;
use swc_core::common::{FileName, SourceMap, GLOBALS};
use swc_core::ecma::ast::{EsVersion, Program};
use swc_core::ecma::parser::{parse_file_as_program, parse_file_as_script, Syntax};
use swc_core::ecma::visit::VisitMutWith;

use swc_plugin_build_conditions::{Config, TransformVisitor};

const CONFIG: &str = r#"{
    "groups": { "platform": ["desktop", "mobile"], "runtime": ["server", "client"] },
    "conditions": { "platform": "desktop", "runtime": "client" }
}"#;

fn parse(source: &str, as_script: bool) -> Program {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(FileName::Anon.into(), source.to_string());
    let mut errors = vec![];

    let program = if as_script {
        parse_file_as_script(
            &fm,
            Syntax::Es(Default::default()),
            EsVersion::Es2022,
            None,
            &mut errors,
        )
        .map(Program::Script)
    } else {
        parse_file_as_program(
            &fm,
            Syntax::Es(Default::default()),
            EsVersion::Es2022,
            None,
            &mut errors,
        )
    };

    assert!(errors.is_empty(), "bench source has parse errors");

    program.expect("bench source should parse")
}

fn bench_case(c: &mut Criterion, name: &str, source: &str, as_script: bool) {
    let program = GLOBALS.set(&Default::default(), || parse(source, as_script));
    let config: Config = serde_json::from_str(CONFIG).expect("invalid bench config");

    c.bench_function(name, |b| {
        b.iter_batched(
            || program.clone(),
            |mut program| {
                GLOBALS.set(&Default::default(), || {
                    program.visit_mut_with(&mut TransformVisitor::new(config.clone()));
                });

                program
            },
            BatchSize::SmallInput,
        )
    });
}

/// A module without a reference to the package — the vast majority of files in a build
fn module_without_package(functions: usize) -> String {
    let mut src = String::from("import { helper } from './helper';\n");

    for i in 0..functions {
        let _ = write!(
            src,
            "export function fn{i}(arg) {{\n\
             \x20   if (arg > {i}) {{\n\
             \x20       return helper(arg) + {i};\n\
             \x20   }}\n\
             \x20   return [1, 2, 3].map((x) => x * {i});\n\
             }}\n"
        );
    }

    src
}

/// A module with switchBuildCondition calls, each branch holding a large value
fn module_with_switches(calls: usize, branch_statements: usize) -> String {
    let mut src =
        String::from("import { switchBuildCondition } from '@memebattle/build-conditions';\n");

    let branch_body = |name: &str| {
        let mut body = String::new();

        for j in 0..branch_statements {
            let _ = writeln!(body, "        const v{j} = arg.{name} + {j};");
        }

        body
    };

    for i in 0..calls {
        let _ = write!(
            src,
            "export const value{i} = switchBuildCondition({{\n\
             \x20   desktop: (arg) => {{\n{}        return arg;\n    }},\n\
             \x20   mobile: (arg) => {{\n{}        return arg;\n    }},\n\
             }});\n",
            branch_body("desktop"),
            branch_body("mobile"),
        );
    }

    src
}

/// A module with switchBuildCondition whose branches reference local
/// declarations with a dependency chain down to an import
fn module_with_dead_declarations(calls: usize) -> String {
    let mut src =
        String::from("import { switchBuildCondition } from '@memebattle/build-conditions';\n");

    for i in 0..calls {
        let _ = writeln!(src, "import {{ mobileHelper{i} }} from './helper{i}';");
    }

    for i in 0..calls {
        let _ = write!(
            src,
            "const mobileBase{i} = (arg) => mobileHelper{i}(arg);\n\
             const mobileImpl{i} = (arg) => mobileBase{i}(arg);\n\
             const desktopImpl{i} = (arg) => arg;\n\
             export const value{i} = switchBuildCondition({{ desktop: desktopImpl{i}, mobile: mobileImpl{i} }});\n"
        );
    }

    src
}

/// Nested statically known ifs with dead else branches
fn module_with_nested_ifs(depth: usize, leaf_statements: usize) -> String {
    let mut src = String::from(
        "import { isBuildConditions } from '@memebattle/build-conditions';\n\
         export function main(arg) {\n",
    );

    for _ in 0..depth {
        src.push_str("if (isBuildConditions('desktop')) {\n");
    }

    for j in 0..leaf_statements {
        let _ = writeln!(src, "arg += {j};");
    }

    for _ in 0..depth {
        src.push_str("} else {\narg -= 1;\n}\n");
    }

    src.push_str("return arg;\n}\n");

    src
}

/// A CommonJS script with a top-level require and helper calls inside functions
fn script_with_requires(functions: usize) -> String {
    let mut src = String::from(
        "const { isBuildConditions } = require('@memebattle/build-conditions');\n",
    );

    for i in 0..functions {
        let _ = write!(
            src,
            "function fn{i}(arg) {{\n\
             \x20   if (isBuildConditions('desktop')) {{\n\
             \x20       return arg + {i};\n\
             \x20   }}\n\
             \x20   return arg - {i};\n\
             }}\n\
             module.exports.fn{i} = fn{i};\n"
        );
    }

    src
}

fn bench_transform(c: &mut Criterion) {
    bench_case(
        c,
        "no_package_reference",
        &module_without_package(500),
        false,
    );
    bench_case(
        c,
        "switch_large_branches",
        &module_with_switches(100, 50),
        false,
    );
    bench_case(c, "nested_known_ifs", &module_with_nested_ifs(50, 100), false);
    bench_case(c, "cjs_script_requires", &script_with_requires(500), true);
    bench_case(
        c,
        "switch_dead_declarations",
        &module_with_dead_declarations(200),
        false,
    );
}

criterion_group!(benches, bench_transform);
criterion_main!(benches);
