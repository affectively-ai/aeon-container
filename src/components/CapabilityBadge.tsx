'use aeon';

/**
 * CapabilityBadge — UCAN tier and permissions display
 *
 * Shows the current execution tier and available capabilities
 * based on the UCAN token.
 */

import React from 'react';

// ── Types ────────────────────────────────────────────────────────

interface CapabilityBadgeProps {
  tier: 'free' | 'pro' | 'enterprise' | 'admin' | null;
  capabilities?: string[];
  agentDid?: string;
}

const TIER_STYLES: Record<string, { bg: string; text: string; label: string }> =
  {
    free: {
      bg: 'bg-[#e6dec8]/50 dark:bg-zinc-800',
      text: 'text-[var(--aeon-text-secondary)] dark:text-zinc-400',
      label: 'Free',
    },
    pro: {
      bg: 'bg-blue-500/10 dark:bg-blue-500/20',
      text: 'text-blue-700 dark:text-blue-400',
      label: 'Pro',
    },
    enterprise: {
      bg: 'bg-purple-500/10 dark:bg-purple-500/20',
      text: 'text-purple-700 dark:text-purple-400',
      label: 'Enterprise',
    },
    admin: {
      bg: 'bg-amber-500/10 dark:bg-amber-500/20',
      text: 'text-amber-700 dark:text-amber-400',
      label: 'Admin',
    },
  };

// ── Component ────────────────────────────────────────────────────

export function CapabilityBadge({
  tier,
  capabilities,
  agentDid,
}: CapabilityBadgeProps) {
  const effectiveTier = tier || 'free';
  const style = TIER_STYLES[effectiveTier] || TIER_STYLES.free;

  return (
    <div
      className="aeon-capability-badge flex items-center gap-2"
      aria-label={`Capability tier: ${style.label}`}
    >
      {/* Tier badge */}
      <span
        className={`aeon-capability-tier-pill inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
      >
        {style.label}
      </span>

      {/* Agent DID (truncated) */}
      {agentDid && agentDid !== 'did:anonymous' && (
        <span
          className="text-[10px] text-[var(--aeon-text-tertiary)] dark:text-zinc-500"
          title={agentDid}
        >
          {agentDid.length > 20
            ? `${agentDid.slice(0, 12)}...${agentDid.slice(-6)}`
            : agentDid}
        </span>
      )}

      {/* Capability count */}
      {capabilities && capabilities.length > 0 && (
        <span
          className="text-[10px] text-[var(--aeon-text-tertiary)] dark:text-zinc-500"
          title={capabilities.join(', ')}
        >
          {capabilities.length} cap{capabilities.length !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
