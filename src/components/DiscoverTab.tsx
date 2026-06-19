import { AlertCircle, RefreshCcw, Target, Trophy, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { formatAddress } from '@/lib/utils'
import { useEcosystemStats } from '@/lib/hooks/useEcosystemStats'
import { useTopBuilders } from '@/lib/hooks/useTopBuilders'
import { t, formatText } from '@/lib/i18n'

interface DiscoverTabProps {
  address?: string | null
  onViewAll?: () => void
}

function hashToHue(address: string): number {
  let hash = 0
  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) % 360
  }
  return hash
}

function BuilderAvatar({ address }: { address: string }) {
  const hue = hashToHue(address)

  return (
    <div
      className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-white/10"
      style={{ background: `hsl(${hue} 70% 55% / 0.28)` }}
      aria-hidden="true"
    >
      <div
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: `hsl(${hue} 80% 60%)` }}
      />
    </div>
  )
}

export function DiscoverTab({ address, onViewAll }: DiscoverTabProps) {
  const stats = useEcosystemStats()
  const buildersState = useTopBuilders(address)

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.2em] text-arc-text-dim">{t('discover.ecosystemPulse')}</p>
            <p className="text-[10px] text-arc-text-dim">{t('discover.liveSnapshot')}</p>
          </div>
          <p className="text-[10px] text-arc-text-dim">
            {t('discover.avgBlockTime')} {stats.isLoading ? '—' : stats.dataComplete ? stats.averageBlockTimeLabel : t('common.unknown')}
          </p>
        </div>

        {stats.error ? (
          <ErrorState
            title={t('discover.couldNotLoadStats')}
            description={stats.error}
            actionLabel={t('activity.retry')}
            onAction={() => void stats.refresh()}
          />
        ) : stats.isLoading ? (
          <LoadingState title={t('state.loading')} description={t('discover.liveSnapshot')} />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Card className="rounded-lg px-2 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('discover.liveSnapshot')}</p>
              <p className="mt-1 text-[13px] font-semibold text-arc-accent">{stats.dataComplete ? stats.volume24h : t('common.unknown')}</p>
            </Card>
            <Card className="rounded-lg px-2 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('discover.mostActiveAddresses')}</p>
              <p className="mt-1 text-[13px] font-semibold text-arc-accent">{stats.dataComplete ? stats.activeWallets : t('common.unknown')}</p>
            </Card>
            <Card className="rounded-lg px-2 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('dailyBrief.totalTx')}</p>
              <p className="mt-1 text-[13px] font-semibold text-arc-accent">{stats.dataComplete ? stats.totalTxs : t('common.unknown')}</p>
            </Card>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.2em] text-arc-text-dim">{t('discover.topBuilders')}</p>
            <p className="text-[10px] text-arc-text-dim">{t('discover.mostActiveAddresses')}</p>
          </div>
          {onViewAll ? (
            <button
              onClick={onViewAll}
              className="text-[10px] font-medium text-arc-accent transition-colors hover:text-arc-accent/80"
            >
              {t('discover.viewAll')}
            </button>
          ) : null}
        </div>

        {buildersState.error ? (
          <ErrorState
            title={t('discover.couldNotLoadBuilders')}
            description={buildersState.error}
            actionLabel={t('activity.retry')}
            onAction={() => void buildersState.refresh()}
          />
        ) : buildersState.isLoading ? (
          <LoadingState title={t('state.loading')} description={t('discover.topBuilders')} />
        ) : buildersState.builders.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('discover.noBuildersYet')}
            description={t('discover.buildersDescription')}
          />
        ) : (
          <div className="space-y-1.5">
            {buildersState.builders.map((builder, index) => (
              <div
                key={builder.address}
                className="flex items-center gap-2 rounded-lg border border-arc-border bg-arc-card px-2 py-2"
              >
                <span className="w-5 text-[10px] font-semibold text-arc-text-dim">#{index + 1}</span>
                <BuilderAvatar address={builder.address} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[11px] font-medium text-arc-text">
                      {formatAddress(builder.address, 4)}
                    </p>
                    {builder.isYou && (
                      <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                        You
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[9px] text-arc-text-dim">
                    {builder.txCount.toLocaleString('en-US')} tx · {builder.volume} vol
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div>
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-arc-text-dim">{t('discover.liveOpportunities')}</p>
          <p className="text-[10px] text-arc-text-dim">{t('discover.communityDrops')}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Card className="flex flex-col gap-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-arc-accent/10 text-arc-accent">
                <Trophy size={16} />
              </div>
              <span className="rounded-full border border-arc-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-arc-text-dim">
                {t('discover.live')}
              </span>
            </div>
            <div>
              <p className="text-[11px] font-medium text-arc-text">{t('discover.hackathon')}</p>
              <p className="mt-0.5 text-[10px] text-arc-text-dim">{formatText('discover.endsIn', { time: '2d 4h' })}</p>
            </div>
          </Card>

          <Card className="flex flex-col gap-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-arc-success/10 text-arc-success">
                <Target size={16} />
              </div>
              <span className="rounded-full border border-arc-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-arc-text-dim">
                {t('discover.open')}
              </span>
            </div>
            <div>
              <p className="text-[11px] font-medium text-arc-text">{t('discover.bounty')}</p>
              <p className="mt-0.5 text-[10px] text-arc-text-dim">{t('discover.communityRewardPool')}</p>
            </div>
          </Card>
        </div>
      </section>
    </div>
  )
}
