import { switchBuildCondition } from 'build-conditions';
import DesktopPage from './Page@desktop';
import MobilePage from './Page@mobile';
export default switchBuildCondition({
    desktop: DesktopPage,
    mobile: MobilePage,
});
