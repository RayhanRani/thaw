import { ShieldCheck } from 'lucide-react'
import { money, plural } from '../lib/format'
import { PageHeader } from '../shell/AppShell'
import { href } from '../shell/routes'
import { useDemo } from '../state/demo'
import { Card } from '../ui'
import { BalanceChart } from './BalanceChart'
import { BalanceHero } from './BalanceHero'
import { HeldBreakdown } from './HeldBreakdown'
import { ReleaseCalendar } from './ReleaseCalendar'

export function MerchantOverview() {
  return (
    <>
      <PageHeader
        eyebrow="Balance"
        title="Your money, thawing"
        subtitle="Every held dollar, why it is held, and when it comes back."
        action={
          <a href={href('merchant')} className="text-[13px] font-medium text-accent-ink hover:underline">
            See every order →
          </a>
        }
      />
      <div className="space-y-5">
        <BalanceHero />
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ReleaseCalendar />
          </div>
          <HeldBreakdown />
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BalanceChart />
          </div>
          <ThreeDSTip />
        </div>
      </div>
    </>
  )
}

function ThreeDSTip() {
  const { authUpside } = useDemo()
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-sky-400/15 blur-2xl" />
      <div className="relative">
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
          <ShieldCheck className="size-5" />
        </div>
        <div className="mt-3 text-[15px] font-semibold">Get paid sooner next time</div>
        <p className="mt-1 text-[13px] text-ink-2">
          Payments authenticated with 3D Secure release their fraud cover the moment they are paid. {plural(authUpside.orders, 'payment')} held today were not authenticated.
        </p>
        <div className="mt-4 rounded-lg bg-surface-2 p-3">
          <div className="text-xs text-muted">Had they been authenticated</div>
          <div className="text-xl font-semibold text-good-ink">{money(authUpside.lessHeld)} less held</div>
        </div>
      </div>
    </Card>
  )
}
