import { setBuildConditions, switchBuildCondition } from '@memebattle/build-conditions';
setBuildConditions({
    platform: 'desktop',
});
export const value = switchBuildCondition({
    desktop: () => 'desktop',
    mobile: () => 'mobile',
});
