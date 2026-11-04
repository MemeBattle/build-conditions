import { switchBuildCondition } from '@memebattle/build-conditions';
import * as desktopIcons from './icons@desktop';
import * as mobileIcons from './icons@mobile';
export const icons = switchBuildCondition({
    desktop: desktopIcons,
    mobile: mobileIcons,
});
