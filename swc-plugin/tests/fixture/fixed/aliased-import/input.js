import { switchBuildCondition as switchCondition, isBuildConditions as isConditions } from 'build-conditions';
import desktopStyles from './styles@desktop.module.css';
import mobileStyles from './styles@mobile.module.css';
export const styles = switchCondition({
    desktop: desktopStyles,
    mobile: mobileStyles,
});
export const flag = isConditions('desktop');
