const { switchBuildCondition } = require('@memebattle/build-conditions');
const desktopImpl = require('./impl@desktop');
const mobileImpl = require('./impl@mobile');
module.exports = desktopImpl;
