import { PageHeader } from '../shell/AppShell'
import { AppealsCard } from './AppealsCard'

export function MerchantAppeals() {
  return (
    <>
      <PageHeader eyebrow="Appeals" title="Contest a hold, get a written answer" subtitle="Every appeal has a stated deadline and ends in a written decision you can act on." />
      <AppealsCard />
    </>
  )
}
