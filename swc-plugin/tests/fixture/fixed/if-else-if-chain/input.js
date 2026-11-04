import { isBuildConditions } from '@memebattle/build-conditions';
import { onDesktop } from './onDesktop';
import { onMobile } from './onMobile';
import { onServer } from './onServer';
export function run() {
    if (isBuildConditions('mobile')) {
        onMobile();
    } else if (isBuildConditions('server')) {
        onServer();
    } else {
        onDesktop();
    }
}
