import { switchBuildCondition } from '@memebattle/build-conditions';
import DesktopPage from './Page@desktop';
import MobilePage from './Page@mobile';
const stub = () => null;
export default switchBuildCondition({
    client: switchBuildCondition({
        desktop: DesktopPage,
        mobile: MobilePage,
    }),
    default: stub,
});
