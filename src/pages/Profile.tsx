import { useState, useMemo } from 'react'
import { ArrowLeft, ExternalLink, Edit2, Share2, Save, X, Lock, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore } from '@/lib/store'
import { formatAddress, copyToClipboard } from '@/lib/utils'
import { useAddressInsights } from '@/lib/hooks/useAddressInsights'
import { t } from '@/lib/i18n'

interface ProfileProps {
  onBack: () => void
}

interface Badge {
  id: string
  label: string
  criteria: string
  isUnlocked: boolean
}

export function Profile({ onBack }: ProfileProps) {
  const walletAddress = useStore((s) => s.walletAddress)
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
  const profile = useStore((s) => s.profile)
  const setProfile = useStore((s) => s.setProfile)
  const accountCreatedAt = useStore((s) => s.accountCreatedAt)
  const { totalTx, totalVolume, dataComplete } = useAddressInsights(walletAddress)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(profile.displayName || '')
  const [editBio, setEditBio] = useState(profile.bio || '')
  const [toast, setToast] = useState('')

  const level = Math.floor(xp / 100)
  const nextLevelXP = (level + 1) * 100
  const progress = xp % 100

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleSave = () => {
    setProfile({ displayName: editName, bio: editBio })
    setIsEditing(false)
    showToast(t('profile.updated'))
  }

  const handleShare = () => {
    const text = `Check my Arc profile on ArcCopilot: ${formatAddress(walletAddress || '')}`
    void copyToClipboard(text)
    showToast(t('profile.linkCopied'))
  }

  const handleConnectX = () => {
    showToast(t('profile.xSoon'))
  }

  const badges = useMemo((): Badge[] => {
    const daysOld = Math.floor((Date.now() - accountCreatedAt) / (1000 * 60 * 60 * 24))
    return [
      { id: 'pioneer', label: t('profile.txPioneer'), criteria: t('profile.txPioneerCriteria'), isUnlocked: dataComplete && (totalTx ?? 0) >= 1 },
      { id: 'whale', label: t('profile.usdcWhale'), criteria: t('profile.usdcWhaleCriteria'), isUnlocked: dataComplete && totalVolume != null && Number(totalVolume / 1000000n) >= 100 },
      { id: 'warrior', label: t('profile.weekWarrior'), criteria: t('profile.weekWarriorCriteria'), isUnlocked: streak >= 7 },
      { id: 'early', label: t('profile.earlyAdopter'), criteria: t('profile.earlyAdopterCriteria'), isUnlocked: daysOld > 30 },
    ]
  }, [totalTx, totalVolume, dataComplete, streak, accountCreatedAt])

  const displayName = profile.displayName || (walletAddress ? formatAddress(walletAddress) : t('common.unknown'))
  const initial = displayName[0].toUpperCase()

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-arc-border sticky top-0 bg-arc-bg/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-base font-semibold text-arc-text">{t('profile.title')}</h2>
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleShare}
            className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-gold transition-colors"
            title={t('profile.shareProfile')}
          >
            <Share2 size={18} />
          </button>
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-gold transition-colors"
            title={t('profile.editProfile')}
          >
            <Edit2 size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl bg-arc-gold/20 flex items-center justify-center text-arc-gold text-3xl font-black shadow-xl border-2 border-arc-gold/30">
              {initial}
            </div>
            <div className="absolute -bottom-2 -right-2 bg-arc-bg border-2 border-arc-gold rounded-full px-2 py-0.5 text-[10px] font-bold text-arc-gold shadow-lg">
              Lv {level}
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-lg font-bold text-arc-text">{displayName}</p>
            <p className="text-xs text-arc-text-dim font-mono">{walletAddress ? formatAddress(walletAddress, 6) : '-'}</p>
          </div>

          {profile.bio && (
            <p className="text-xs text-arc-text-dim text-center px-4 italic">
              &quot;{profile.bio}&quot;
            </p>
          )}

          <div className="flex items-center gap-2 w-full max-w-[200px] mt-2">
            <div className="flex-1 h-1.5 bg-arc-border rounded-full overflow-hidden">
              <div
                className="h-full bg-arc-gold shadow-[0_0_8px_rgba(212,175,55,0.5)] transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-arc-text-dim whitespace-nowrap">
              {xp} / {nextLevelXP} XP
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs px-3 py-1 rounded-full bg-arc-gold/10 text-arc-gold border border-arc-gold/20 font-bold">
              Level {level}
            </span>
            <span className="text-xs px-3 py-1 rounded-full bg-arc-danger/10 text-arc-danger border border-arc-danger/20 font-bold">
              {t('common.streak').replace('{streak}', String(streak))}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-arc-text-dim ml-1">{t('profile.social')}</p>
          <Button variant="outline" fullWidth onClick={handleConnectX}>
            <ExternalLink size={14} />
            {t('profile.connectX')}
          </Button>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-arc-text-dim ml-1">{t('profile.badges')}</p>
          <div className="grid grid-cols-2 gap-3">
            {badges.map((badge) => (
              <Card
                key={badge.id}
                className={`relative flex flex-col items-center gap-2 p-3 text-center transition-all group ${
                  badge.isUnlocked
                    ? 'bg-arc-gold/5 border-arc-gold/30 shadow-lg shadow-arc-gold/5'
                    : 'opacity-60 bg-arc-card/30'
                }`}
              >
                {!badge.isUnlocked && (
                  <div className="absolute inset-0 flex items-center justify-center bg-arc-bg/40 backdrop-blur-[1px] rounded-2xl z-10">
                    <Lock size={16} className="text-arc-text-dim" />
                  </div>
                )}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                  badge.isUnlocked ? 'bg-arc-gold/20 text-arc-gold' : 'bg-arc-border text-arc-text-dim'
                }`}>
                  <Trophy size={20} />
                </div>
                <div className="space-y-0.5">
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${badge.isUnlocked ? 'text-arc-gold' : 'text-arc-text-dim'}`}>
                    {badge.label}
                  </p>
                  <p className="text-[8px] text-arc-text-dim leading-tight">
                    {badge.isUnlocked ? t('profile.achievementUnlocked') : badge.criteria}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm p-5 space-y-4 shadow-2xl border-arc-gold/20">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-arc-text">{t('profile.editProfileDialog')}</h3>
              <button onClick={() => setIsEditing(false)} className="text-arc-text-dim hover:text-arc-text">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <Input
                label={t('profile.displayName')}
                placeholder={t('profile.howShouldWeCallYou')}
                value={editName}
                onChange={(e) => setEditName(e.target.value.slice(0, 32))}
              />
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">
                  {t('profile.bio')}
                </label>
                <textarea
                  className="w-full bg-arc-bg border border-arc-border rounded-xl p-3 text-sm text-arc-text placeholder:text-arc-text-dim focus:outline-none focus:border-arc-gold/50 transition-colors min-h-[100px] resize-none"
                  placeholder={t('profile.tellUsAboutYourself')}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value.slice(0, 160))}
                />
                <p className="text-[9px] text-right text-arc-text-dim">
                  {editBio.length} / 160
                </p>
              </div>
            </div>

            <Button variant="primary" fullWidth onClick={handleSave}>
              <Save size={16} />
              {t('profile.saveProfile')}
            </Button>
          </Card>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-arc-card border border-arc-gold/50 text-arc-gold px-4 py-2 rounded-full text-xs font-bold shadow-2xl backdrop-blur-md">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
