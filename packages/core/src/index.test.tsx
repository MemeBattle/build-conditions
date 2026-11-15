import { createRef, forwardRef, memo } from 'react';
import { render, screen } from '@testing-library/react';

import { isBuildConditions, setBuildConditions, switchBuildCondition } from './index';
import { resetBuildConditionsStorage } from './testing';

beforeEach(() => {
    resetBuildConditionsStorage();
});

describe('switchBuildCondition', () => {
    describe('functions', () => {
        it('picks the function matching the condition', () => {
            const fn = switchBuildCondition({
                desktop: (x: number) => x * 2,
                mobile: (x: number) => x * 3,
            });

            setBuildConditions({ platform: 'desktop' });
            expect(fn(5)).toBe(10);

            setBuildConditions({ platform: 'mobile' });
            expect(fn(5)).toBe(15);
        });

        it('switches dynamically without recreation', () => {
            const callCount = { desktop: 0, mobile: 0 };

            const fn = switchBuildCondition({
                desktop: () => {
                    callCount.desktop++;

                    return 'desk';
                },
                mobile: () => {
                    callCount.mobile++;

                    return 'mob';
                },
            });

            setBuildConditions({ platform: 'desktop' });
            expect(fn()).toBe('desk');
            expect(fn()).toBe('desk');

            setBuildConditions({ platform: 'mobile' });
            expect(fn()).toBe('mob');

            expect(callCount).toEqual({ desktop: 2, mobile: 1 });
        });

        it('forwards this', () => {
            const fn = switchBuildCondition({
                desktop: function (this: { value: number }) {
                    return this.value;
                },
                mobile: function (this: { value: number }) {
                    return this.value * 2;
                },
            });

            setBuildConditions({ platform: 'desktop' });
            expect(fn.call({ value: 10 })).toBe(10);

            setBuildConditions({ platform: 'mobile' });
            expect(fn.call({ value: 10 })).toBe(20);
        });
    });

    describe('React function component', () => {
        it('renders the component matching the condition', () => {
            const Desktop = () => <div data-testid="result">desktop</div>;
            const Mobile = () => <div data-testid="result">mobile</div>;

            const Component = switchBuildCondition({ desktop: Desktop, mobile: Mobile });

            setBuildConditions({ platform: 'desktop' });
            const { unmount } = render(<Component />);
            expect(screen.getByTestId('result')).toHaveTextContent('desktop');
            unmount();

            setBuildConditions({ platform: 'mobile' });
            render(<Component />);
            expect(screen.getByTestId('result')).toHaveTextContent('mobile');
        });

        it('passes props through', () => {
            const Desktop = ({ name }: { name: string }) => <span>{name}-desktop</span>;
            const Mobile = ({ name }: { name: string }) => <span>{name}-mobile</span>;

            const Component = switchBuildCondition({ desktop: Desktop, mobile: Mobile });

            setBuildConditions({ platform: 'desktop' });
            const { container } = render(<Component name="test" />);
            expect(container.textContent).toBe('test-desktop');
        });
    });

    describe('React.memo()', () => {
        it('renders memo components', () => {
            const Desktop = memo(() => <div data-testid="memo">memo-desktop</div>);
            const Mobile = memo(() => <div data-testid="memo">memo-mobile</div>);

            const Component = switchBuildCondition({ desktop: Desktop, mobile: Mobile });

            setBuildConditions({ platform: 'desktop' });
            const { unmount } = render(<Component />);
            expect(screen.getByTestId('memo')).toHaveTextContent('memo-desktop');
            unmount();

            setBuildConditions({ platform: 'mobile' });
            render(<Component />);
            expect(screen.getByTestId('memo')).toHaveTextContent('memo-mobile');
        });

        it('memoization survives a re-render', () => {
            let renderCount = 0;
            const Inner = memo(({ value }: { value: string }) => {
                renderCount++;

                return <div data-testid="memo-count">{value}</div>;
            });

            const Component = switchBuildCondition({ desktop: Inner, mobile: Inner });

            setBuildConditions({ platform: 'desktop' });
            const { rerender } = render(<Component value="hello" />);
            expect(renderCount).toBe(1);

            rerender(<Component value="hello" />);
            expect(renderCount).toBe(1);
        });
    });

    describe('React.forwardRef()', () => {
        it('renders and forwards the ref', () => {
            const Desktop = forwardRef<HTMLDivElement, { text: string }>(({ text }, ref) => (
                <div ref={ref} data-testid="fref">
                    {text}-desktop
                </div>
            ));
            const Mobile = forwardRef<HTMLDivElement, { text: string }>(({ text }, ref) => (
                <div ref={ref} data-testid="fref">
                    {text}-mobile
                </div>
            ));

            const Component = switchBuildCondition({ desktop: Desktop, mobile: Mobile });

            setBuildConditions({ platform: 'desktop' });
            const ref = createRef<HTMLDivElement>();
            render(<Component text="test" ref={ref} />);

            expect(screen.getByTestId('fref')).toHaveTextContent('test-desktop');
            expect(ref.current).toBeInstanceOf(HTMLDivElement);
        });
    });

    describe('memo(forwardRef())', () => {
        it('renders and forwards the ref', () => {
            const Desktop = memo(
                forwardRef<HTMLButtonElement, { label: string }>(({ label }, ref) => (
                    <button ref={ref} data-testid="mfr">
                        {label}-desktop
                    </button>
                ))
            );
            const Mobile = memo(
                forwardRef<HTMLButtonElement, { label: string }>(({ label }, ref) => (
                    <button ref={ref} data-testid="mfr">
                        {label}-mobile
                    </button>
                ))
            );

            const Component = switchBuildCondition({ desktop: Desktop, mobile: Mobile });

            setBuildConditions({ platform: 'mobile' });
            const ref = createRef<HTMLButtonElement>();
            render(<Component label="btn" ref={ref} />);

            expect(screen.getByTestId('mfr')).toHaveTextContent('btn-mobile');
            expect(ref.current).toBeInstanceOf(HTMLButtonElement);
        });
    });

    describe('objects (CSS Modules)', () => {
        it('proxies property access', () => {
            const desktopStyles = { root: 'root_desktop', title: 'title_desktop' };
            const mobileStyles = { root: 'root_mobile', title: 'title_mobile' };

            const styles = switchBuildCondition({ desktop: desktopStyles, mobile: mobileStyles });

            setBuildConditions({ platform: 'desktop' });
            expect(styles.root).toBe('root_desktop');
            expect(styles.title).toBe('title_desktop');

            setBuildConditions({ platform: 'mobile' });
            expect(styles.root).toBe('root_mobile');
        });

        it('in operator', () => {
            const styles = switchBuildCondition({
                desktop: { root: 'a', extra: 'b' },
                mobile: { root: 'c' },
            });

            setBuildConditions({ platform: 'desktop' });
            expect('extra' in styles).toBe(true);

            setBuildConditions({ platform: 'mobile' });
            expect('extra' in styles).toBe(false);
        });

        it('Object.keys', () => {
            const styles = switchBuildCondition({
                desktop: { a: '1', b: '2', c: '3' },
                mobile: { x: '1' },
            });

            setBuildConditions({ platform: 'desktop' });
            expect(Object.keys(styles)).toEqual(['a', 'b', 'c']);

            setBuildConditions({ platform: 'mobile' });
            expect(Object.keys(styles)).toEqual(['x']);
        });
    });

    describe('default', () => {
        it('falls back to default when no condition matches', () => {
            const fn = switchBuildCondition({
                default: () => 'default-result',
                server: () => 'server-result',
            });

            setBuildConditions({ runtime: 'server' });
            expect(fn()).toBe('server-result');

            setBuildConditions({ runtime: 'client' });
            expect(fn()).toBe('default-result');
        });

        it('a direct condition takes priority over default', () => {
            const fn = switchBuildCondition({
                default: () => 'fallback',
                desktop: () => 'desk',
            });

            setBuildConditions({ platform: 'desktop' });
            expect(fn()).toBe('desk');

            setBuildConditions({ platform: 'mobile' });
            expect(fn()).toBe('fallback');
        });

        it('throws when there is neither a match nor a default', () => {
            const fn = switchBuildCondition({ desktop: () => 'ok' });

            setBuildConditions({ platform: 'mobile' });
            expect(() => fn()).toThrow('no value for the current conditions');
        });
    });

    describe('nested switchBuildCondition', () => {
        const createComponent = () =>
            switchBuildCondition({
                client: switchBuildCondition({
                    desktop: () => <div data-testid="page">PageWithStub</div>,
                    default: () => <div data-testid="page">Empty</div>,
                }),
                default: () => <div data-testid="page">stub</div>,
            });

        it('runtime=client, platform=desktop → PageWithStub', () => {
            const Component = createComponent();

            setBuildConditions({ runtime: 'client', platform: 'desktop' });
            const { unmount } = render(<Component />);
            expect(screen.getByTestId('page')).toHaveTextContent('PageWithStub');
            unmount();
        });

        it('runtime=client, platform=mobile → Empty (inner default)', () => {
            const Component = createComponent();

            setBuildConditions({ runtime: 'client', platform: 'mobile' });
            const { unmount } = render(<Component />);
            expect(screen.getByTestId('page')).toHaveTextContent('Empty');
            unmount();
        });

        it('runtime=server → stub (outer default)', () => {
            const Component = createComponent();

            setBuildConditions({ runtime: 'server', platform: 'desktop' });
            const { unmount } = render(<Component />);
            expect(screen.getByTestId('page')).toHaveTextContent('stub');
            unmount();
        });

        it('switches nested conditions dynamically', () => {
            const Component = createComponent();

            setBuildConditions({ runtime: 'client', platform: 'desktop' });
            const { unmount: u1 } = render(<Component />);
            expect(screen.getByTestId('page')).toHaveTextContent('PageWithStub');
            u1();

            setBuildConditions({ platform: 'mobile' });
            const { unmount: u2 } = render(<Component />);
            expect(screen.getByTestId('page')).toHaveTextContent('Empty');
            u2();

            setBuildConditions({ runtime: 'server' });
            const { unmount: u3 } = render(<Component />);
            expect(screen.getByTestId('page')).toHaveTextContent('stub');
            u3();
        });
    });

    describe('typing: homogeneity and groups', () => {
        it('homogeneous functions — allowed', () => {
            const result = switchBuildCondition({
                desktop: (x: number) => x * 2,
                mobile: (x: number) => x * 3,
            });
            setBuildConditions({ platform: 'desktop' });
            expect(result(1)).toBe(2);
        });

        it('homogeneous objects — allowed', () => {
            const result = switchBuildCondition({
                desktop: { root: 'a' },
                mobile: { root: 'b' },
            });
            setBuildConditions({ platform: 'desktop' });
            expect(result.root).toBe('a');
        });

        it('mixing a function and an object — type error', () => {
            const obj = { root: 'a' };
            const fn = () => 'b';

            // @ts-expect-error — functions and objects cannot be mixed
            switchBuildCondition({ desktop: obj, mobile: fn });
        });

        it('mixing memo and a plain function — type error', () => {
            const Memo = memo(() => <div>m</div>);
            const Fn = () => <div>f</div>;

            // @ts-expect-error — memo (an object) + function cannot be mixed
            switchBuildCondition({ desktop: Memo, mobile: Fn });
        });

        it('mixing groups in one map — type error', () => {
            const Desktop = () => <div>d</div>;
            const Server = () => <div>s</div>;

            // @ts-expect-error — keys desktop and server belong to different groups
            switchBuildCondition({ desktop: Desktop, server: Server });
        });

        it('primitives are forbidden', () => {
            // @ts-expect-error — strings are not AllowedValue
            switchBuildCondition({ desktop: 'hello', mobile: 'world' });
        });
    });
});

describe('isBuildConditions', () => {
    it('true when the condition is active', () => {
        setBuildConditions({ platform: 'desktop' });
        expect(isBuildConditions('desktop')).toBe(true);
        expect(isBuildConditions('mobile')).toBe(false);
    });

    it('multiple conditions — true only when all are active', () => {
        setBuildConditions({ platform: 'desktop', runtime: 'client' });
        expect(isBuildConditions(['desktop', 'client'])).toBe(true);
        expect(isBuildConditions(['desktop', 'server'])).toBe(false);
    });

    it('two values from one group are rejected by the types', () => {
        setBuildConditions({ platform: 'desktop' });
        // @ts-expect-error — desktop and mobile belong to the same group
        expect(isBuildConditions(['desktop', 'mobile'])).toBe(false);
    });

    it('throws when conditions are not set', () => {
        // the storage is empty — getBuildConditions throws
        expect(() => isBuildConditions('desktop')).toThrow();
    });
});
