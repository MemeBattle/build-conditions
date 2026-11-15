//! SWC plugin of the `@memebattle/build-conditions` package.
//!
//! Replaces `switchBuildCondition` / `isBuildConditions` calls with
//! compile-time values according to the configuration:
//!
//! ```json
//! {
//!     "groups": { "platform": ["desktop", "mobile"], "runtime": ["server", "client"] },
//!     "conditions": { "platform": "desktop", "runtime": null }
//! }
//! ```
//!
//! - a group with a string value in `conditions` is fixed: the matching
//!   branch is inlined, `isBuildConditions` is folded into `true` / `false`,
//!   dead `if (isBuildConditions(...))` branches are removed together with
//!   imports that become unused;
//! - a group with a `null` value is not fixed: its calls stay in runtime.
//!
//! `groups` contains the complete set of values of every group — it lets a
//! value be unambiguously resolved to its group (values are unique across
//! groups). Helper arguments must be literals; a value not found in any
//! group is a build error. Dynamic checks belong to `getBuildConditions`,
//! which the plugin deliberately leaves untouched.

mod transform;

use serde::Deserialize;
use std::collections::BTreeMap;
use swc_core::ecma::ast::Program;
use swc_core::ecma::visit::VisitMutWith;
use swc_core::plugin::{plugin_transform, proxies::TransformPluginProgramMetadata};

pub use transform::TransformVisitor;

/// Plugin configuration, see `PluginOptions` in `@memebattle/build-conditions`
#[derive(Deserialize, Debug, Default, Clone)]
pub struct Config {
    /// Complete composition of condition groups: group → all of its values
    pub groups: BTreeMap<String, Vec<String>>,
    /// Chosen group values: a string means the group is fixed, null — runtime
    pub conditions: BTreeMap<String, Option<String>>,
}

impl Config {
    /// Validates the configuration and builds the "condition value → its group" map.
    ///
    /// Checked invariants:
    /// - the group sets in `groups` and `conditions` match;
    /// - condition values are unique across groups;
    /// - a fixed value belongs to its group.
    pub fn validate(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let mut value_to_group = std::collections::HashMap::new();

        for (group, values) in &self.groups {
            if !self.conditions.contains_key(group) {
                return Err(format!(
                    "build-conditions: group '{group}' is present in groups but missing from conditions"
                ));
            }

            for value in values {
                if let Some(other) = value_to_group.insert(value.clone(), group.clone()) {
                    return Err(format!(
                        "build-conditions: value '{value}' belongs to two groups at once ('{other}' and '{group}'), values must be unique across groups"
                    ));
                }
            }
        }

        for (group, chosen) in &self.conditions {
            let Some(values) = self.groups.get(group) else {
                return Err(format!(
                    "build-conditions: group '{group}' is present in conditions but missing from groups"
                ));
            };

            if let Some(chosen) = chosen {
                if !values.contains(chosen) {
                    return Err(format!(
                        "build-conditions: value '{chosen}' does not belong to group '{group}'"
                    ));
                }
            }
        }

        Ok(value_to_group)
    }
}

#[cfg(test)]
mod tests {
    use super::Config;

    fn config(json: &str) -> Config {
        serde_json::from_str(json).expect("invalid config json")
    }

    #[test]
    fn valid_config_builds_value_to_group_map() {
        let map = config(
            r#"{
                "groups": { "platform": ["desktop", "mobile"], "runtime": ["server", "client"] },
                "conditions": { "platform": "desktop", "runtime": null }
            }"#,
        )
        .validate()
        .expect("config should be valid");

        assert_eq!(map.len(), 4);
        assert_eq!(map.get("desktop").map(String::as_str), Some("platform"));
        assert_eq!(map.get("mobile").map(String::as_str), Some("platform"));
        assert_eq!(map.get("server").map(String::as_str), Some("runtime"));
        assert_eq!(map.get("client").map(String::as_str), Some("runtime"));
    }

    #[test]
    fn empty_config_is_valid() {
        let map = config(r#"{ "groups": {}, "conditions": {} }"#)
            .validate()
            .expect("empty config should be valid");

        assert!(map.is_empty());
    }

    #[test]
    fn group_missing_in_conditions() {
        let error = config(r#"{ "groups": { "platform": ["desktop", "mobile"] }, "conditions": {} }"#)
            .validate()
            .unwrap_err();

        assert!(
            error.contains("group 'platform' is present in groups but missing from conditions"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn group_missing_in_groups() {
        let error = config(r#"{ "groups": {}, "conditions": { "platform": "desktop" } }"#)
            .validate()
            .unwrap_err();

        assert!(
            error.contains("group 'platform' is present in conditions but missing from groups"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn duplicate_value_between_groups() {
        let error = config(
            r#"{
                "groups": { "platform": ["desktop", "mobile"], "runtime": ["server", "desktop"] },
                "conditions": { "platform": "desktop", "runtime": "server" }
            }"#,
        )
        .validate()
        .unwrap_err();

        assert!(
            error.contains("value 'desktop' belongs to two groups at once"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn chosen_value_not_in_group() {
        let error = config(
            r#"{
                "groups": { "platform": ["desktop", "mobile"] },
                "conditions": { "platform": "tablet" }
            }"#,
        )
        .validate()
        .unwrap_err();

        assert!(
            error.contains("value 'tablet' does not belong to group 'platform'"),
            "unexpected error: {error}"
        );
    }
}

#[plugin_transform]
pub fn process_transform(
    mut program: Program,
    metadata: TransformPluginProgramMetadata,
) -> Program {
    let config: Config = serde_json::from_str(
        &metadata
            .get_transform_plugin_config()
            .expect("failed to get build-conditions plugin config"),
    )
    .expect("invalid build-conditions plugin config");

    program.visit_mut_with(&mut TransformVisitor::new(config));
    program
}
