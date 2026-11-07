import { isBuildConditions, switchBuildCondition } from '@memebattle/build-conditions';
import { trackMobile } from './analytics';

const mobileTracker = switchBuildCondition({
    client: () => trackMobile(),
    server: () => {},
});
const trackOnClient = isBuildConditions('client');

export function init() {
    if (isBuildConditions('mobile')) {
        if (trackOnClient) {
            mobileTracker();
        }
    }
}
