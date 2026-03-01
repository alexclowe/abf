/**
 * Server-side onboarding state — persisted in abf.config.yaml under the
 * `onboarding` key via the config API.  Works across browsers and devices
 * (critical for ABF Cloud) because state lives in the project, not the browser.
 *
 * Shape in config:
 *   onboarding:
 *     dismissed: true
 *     build_plan_reviewed: true
 */

import { api } from './api';

export interface OnboardingState {
  dismissed?: boolean;
  build_plan_reviewed?: boolean;
}

/** Read onboarding state from config (returns {} if missing). */
export function getOnboardingState(config: Record<string, unknown> | null | undefined): OnboardingState {
  if (!config || typeof config.onboarding !== 'object' || config.onboarding === null) return {};
  return config.onboarding as OnboardingState;
}

/** Merge updates into onboarding state and PUT the full config back. */
export async function updateOnboardingState(updates: Partial<OnboardingState>): Promise<void> {
  const config = await api.config.get();
  const current = getOnboardingState(config);
  const merged = { ...config, onboarding: { ...current, ...updates } };
  await api.config.update(merged);
}
