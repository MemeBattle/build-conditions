import { switchBuildCondition } from '@memebattle/build-conditions';
import { withTheme } from './withTheme';
import { DesktopView } from './View@desktop';
import { MobileView } from './View@mobile';
export const View = switchBuildCondition({
    desktop: withTheme(DesktopView),
    mobile: withTheme(MobileView),
});
