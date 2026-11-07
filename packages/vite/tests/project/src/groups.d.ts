import '@memebattle/build-conditions';

declare module '@memebattle/build-conditions' {
    interface BuildConditionGroups {
        platform: 'desktop' | 'mobile';
        runtime: 'server' | 'client';
    }
}
