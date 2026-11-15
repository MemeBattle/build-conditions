import type { CSSProperties } from 'react';

import { isBuildConditions, switchBuildCondition } from './index';

const cardStyle: CSSProperties = {
    fontFamily: 'sans-serif',
    border: '1px solid #d9dde3',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    maxWidth: 480,
};

const DesktopBanner = () => (
    <div style={{ ...cardStyle, background: '#eef4ff' }}>
        🖥️ <b>Desktop</b> component (switchBuildCondition, function branch)
    </div>
);

const MobileBanner = () => (
    <div style={{ ...cardStyle, background: '#fff3e6', maxWidth: 320 }}>
        📱 <b>Mobile</b> component (switchBuildCondition, function branch)
    </div>
);

const Banner = switchBuildCondition({
    desktop: DesktopBanner,
    mobile: MobileBanner,
});

const palette = switchBuildCondition({
    desktop: { accent: '#2b6cee', label: 'desktop palette (object branch via Proxy)' },
    mobile: { accent: '#e8793a', label: 'mobile palette (object branch via Proxy)' },
});

const NestedExample = switchBuildCondition({
    client: switchBuildCondition({
        desktop: () => <span>client + desktop → PageWithStub</span>,
        default: () => <span>client + mobile → Empty</span>,
    }),
    default: () => <span>server → stub</span>,
});

/**
 * ⚠️ Anti-pattern shown on purpose: a top-level isBuildConditions call.
 * The value is computed once at module import: on the first story load the
 * conditions are not set yet (the decorator runs later) — the call throws,
 * and afterwards it freezes the value and ignores toolbar switches.
 * The try/catch is only here so the failing module does not break the demo.
 */
let frozenIsDesktop: string;

try {
    frozenIsDesktop = String(isBuildConditions('desktop'));
} catch {
    frozenIsDesktop = 'threw: conditions are not set yet at module import';
}

const Check = ({ label, value }: { label: string; value: boolean }) => (
    <li>
        <code>{label}</code> → <b style={{ color: value ? '#1d8a3c' : '#c53030' }}>{String(value)}</b>
    </li>
);

export default {
    title: 'BuildConditions/Demo',
};

export const Demo = () => (
    <div style={{ fontFamily: 'sans-serif' }}>
        <p style={{ maxWidth: 480 }}>
            Switch <b>platform</b> and <b>runtime</b> in the toolbar above — the helpers resolve branches in runtime
            mode (no SWC plugin) on every render.
        </p>

        <Banner />

        <div style={{ ...cardStyle, borderLeft: `6px solid ${palette.accent}` }}>
            🎨 <code>styles.accent = {palette.accent}</code> — {palette.label}
        </div>

        <div style={cardStyle}>
            🪆 Nested <code>switchBuildCondition</code> (runtime → platform): <NestedExample />
        </div>

        <div style={{ ...cardStyle, background: '#fff5f5', borderColor: '#f3c0c0' }}>
            ⚠️ Anti-pattern — top-level <code>isBuildConditions</code> is frozen at module import and ignores the
            toolbar:
            <ul>
                <li>
                    <code>const frozen = isBuildConditions(&apos;desktop&apos;)</code> (top-level) →{' '}
                    <b style={{ color: '#c53030' }}>{frozenIsDesktop}</b>
                </li>
                <li>
                    same call in render → <b style={{ color: '#1d8a3c' }}>{String(isBuildConditions('desktop'))}</b>{' '}
                    (live)
                </li>
            </ul>
        </div>

        <div style={cardStyle}>
            ✅ <code>isBuildConditions</code>:
            <ul>
                <Check label="isBuildConditions('desktop')" value={isBuildConditions('desktop')} />
                <Check label="isBuildConditions('mobile')" value={isBuildConditions('mobile')} />
                <Check
                    label="isBuildConditions(['desktop', 'client'])"
                    value={isBuildConditions(['desktop', 'client'])}
                />
                <Check
                    label="isBuildConditions(['mobile', 'server'])"
                    value={isBuildConditions(['mobile', 'server'])}
                />
            </ul>
        </div>
    </div>
);
