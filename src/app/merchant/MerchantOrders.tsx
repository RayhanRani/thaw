import { useState } from 'react'
import { PageHeader } from '../shell/AppShell'
import { OrderDrawer } from './OrderDrawer'
import { OrdersTable } from './OrdersTable'

export function MerchantOrders() {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <>
      <PageHeader eyebrow="Orders" title="Every order, and why it's held" subtitle="Select an order to see its release range, the proof on file, its full history, or to contest the hold." />
      <OrdersTable onOpen={setOpenId} />
      <OrderDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}
