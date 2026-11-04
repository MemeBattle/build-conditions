function a() {
    const { switchBuildCondition } = require('build-conditions');

    return switchBuildCondition({
        desktop: 'desktop',
        mobile: 'mobile',
    });
}

function b() {
    // switchBuildCondition is NOT from build-conditions here
    return switchBuildCondition({
        desktop: 'desktop',
        mobile: 'mobile',
    });
}
