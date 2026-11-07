use std::path::PathBuf;

use swc_core::common::Mark;
use swc_core::ecma::ast::Pass;
use swc_core::ecma::transforms::{
    base::resolver,
    testing::{test_fixture, FixtureTestConfig},
};
use swc_core::ecma::visit::visit_mut_pass;

use swc_plugin_build_conditions::{Config, TransformVisitor};

use testing::fixture;

const FIXED_CONFIG: &str = r#"{
    "groups": { "platform": ["desktop", "mobile"], "runtime": ["server", "client"] },
    "conditions": { "platform": "desktop", "runtime": "client" }
}"#;

const PARTIAL_CONFIG: &str = r#"{
    "groups": { "platform": ["desktop", "mobile"], "runtime": ["server", "client"] },
    "conditions": { "platform": null, "runtime": "client" }
}"#;

fn tr(config_json: &str) -> impl Pass {
    let config: Config = serde_json::from_str(config_json).expect("invalid fixture config");

    (
        resolver(Mark::new(), Mark::new(), false),
        visit_mut_pass(TransformVisitor::new(config)),
    )
}

/// All groups are fixed
#[fixture("../../fixtures/fixed/**/input.js")]
fn fixtures_fixed(input: PathBuf) {
    let output = input.parent().unwrap().join("output.js");

    test_fixture(
        Default::default(),
        &|_t| tr(FIXED_CONFIG),
        &input,
        &output,
        Default::default(),
    );
}

/// The platform group is not fixed (null), runtime is fixed
#[fixture("../../fixtures/partial/**/input.js")]
fn fixtures_partial(input: PathBuf) {
    let output = input.parent().unwrap().join("output.js");

    test_fixture(
        Default::default(),
        &|_t| tr(PARTIAL_CONFIG),
        &input,
        &output,
        Default::default(),
    );
}

/// Build errors: the call stays untouched, HANDLER receives span_err
#[fixture("../../fixtures/errors/**/input.js")]
fn fixtures_errors(input: PathBuf) {
    let output = input.parent().unwrap().join("output.js");

    test_fixture(
        Default::default(),
        &|_t| tr(FIXED_CONFIG),
        &input,
        &output,
        FixtureTestConfig {
            allow_error: true,
            ..Default::default()
        },
    );
}

/// An invalid config panics during visitor initialization
/// (the validation rules themselves are covered by `Config::validate` unit tests in lib.rs)
#[test]
#[should_panic(expected = "is present in groups but missing from conditions")]
fn invalid_config_panics() {
    let config: Config =
        serde_json::from_str(r#"{ "groups": { "platform": ["desktop", "mobile"] }, "conditions": {} }"#)
            .expect("invalid config json");

    TransformVisitor::new(config);
}
