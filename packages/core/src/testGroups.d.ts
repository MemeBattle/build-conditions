/**
 * Test condition groups for the package's own unit tests.
 *
 * The declaration merging applies to the whole package during the local
 * typecheck but never reaches consumer programs — the file is not imported
 * from any entrypoint.
 */
import './index';

declare module './index' {
    interface BuildConditionGroups {
        platform: 'desktop' | 'mobile';
        runtime: 'server' | 'client';
    }
}
