import { isBuildConditions } from '@memebattle/build-conditions';
import { mobileOnly } from './mobileOnly';

export function run() {
    if (isBuildConditions('mobile')) {
        class Mobile {
            constructor() {
                var q = mobileOnly();
                this.q = q;
            }
        }
    }
}
