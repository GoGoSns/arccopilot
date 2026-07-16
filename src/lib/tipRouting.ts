import { agentTip, isAutonomousEnabled, type AgentTipResult } from '@/lib/agentBackend'
import { getPolicy, isPaired, userTip } from '@/lib/pairing'

export type AutonomousTipSource = 'paired' | 'legacy'
export type TipRoute = AutonomousTipSource | 'signed'

export interface RoutedTipResult extends AgentTipResult {
  source: AutonomousTipSource
}

export async function resolveTipRoute(): Promise<TipRoute> {
  if (await isPaired()) {
    const policy = await getPolicy()
    if (policy.autonomousEnabled) {
      return 'paired'
    }
  }

  return await isAutonomousEnabled() ? 'legacy' : 'signed'
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
