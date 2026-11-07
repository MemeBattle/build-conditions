import { isBuildConditions } from '@memebattle/build-conditions';
import { mobileOnly } from './mobileOnly';
export function run() {
    if (isBuildConditions('mobile')) {
        var cache = mobileOnly();
        console.log(cache);
    }
}
