import { switchBuildCondition } from '@memebattle/build-conditions';
import PageWithStub from './PageWithStub';
import Empty from './Empty';
const stub = () => null;
export default switchBuildCondition({
    client: switchBuildCondition({
        desktop: PageWithStub,
        default: Empty,
    }),
    default: stub,
});
