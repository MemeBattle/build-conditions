function a() {
    const { switchBuildCondition: switchBuildCondition1 } = require('build-conditions');
    return 'desktop';
}
function b() {
    // switchBuildCondition is NOT from build-conditions here
    return switchBuildCondition({
        desktop: 'desktop',
        mobile: 'mobile',
    });
}
