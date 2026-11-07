import { switchBuildCondition } from '@memebattle/build-conditions';
import DesktopPage from './Page@desktop';
import MobilePage from './Page@mobile';
export default switchBuildCondition({
    desktop: DesktopPage,
    mobile: MobilePage,
});
