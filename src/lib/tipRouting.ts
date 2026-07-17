import { agentTip, isAutonomousEnabled, type AgentTipResult } from '@/lib/agentBackend'
import { getPolicy, isPaired, userTip } from '@/lib/pairing'

export type AutonomousTipSource = 'paired' | 'legacy'
export type TipRoute = AutonomousTipSource | 'signed'

export interface TipRouteLogContext {
  intent?: string
  recipient?: string
  amount?: string
}

export interface RoutedTipResult extends AgentTipResult {
  source: AutonomousTipSource
}

export async function resolveTipRoute(context: TipRouteLogContext = {}): Promise<TipRoute> {
  const paired = await isPaired()
  let perUserAutonomousEnabled = false

  if (paired) {
    const policy = await getPolicy()
    perUserAutonomousEnabled = policy.autonomousEnabled
  }

  const legacyToggle = await isAutonomousEnabled()
  const route: TipRoute = paired && perUserAutonomousEnabled
    ? 'paired'
    : legacyToggle
      ? 'legacy'
      : 'signed'
  const branch = route === 'paired'
    ? 'paired-userTip'
    : route === 'legacy'
      ? 'legacy-/agent/tip'
      : 'signed-metamask-gateway'

  console.info(
    `[ROUTE] intent=${context.intent ?? 'unknown'} recipient=${context.recipient ?? ''} amount=${context.amount ?? ''} isPaired=${paired} perUserAutonomousEnabled=${perUserAutonomousEnabled} legacyToggle=${legacyToggle} branch=${branch}`,
  )

  return route
}

export function isAutonomousTipRoute(route: TipRoute): route is AutonomousTipSource {
  return route !== 'signed'
}

export async function sendRoutedAutonomousTip(
  route: AutonomousTipSource,
  recipient: string,
  amount: string,
): Promise<RoutedTipResult> {
  const result = route === 'paired'
    ? await userTip(recipient, amount)
    : await agentTip(recipient, amount)

  return { ...result, source: route }
}
