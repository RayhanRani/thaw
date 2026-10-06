import { useEffect, useState } from 'react'
import { AdminHome } from './admin/AdminHome'
import { Landing } from './landing/Landing'
import { MerchantHome } from './merchant/MerchantHome'
import { AppShell } from './shell/AppShell'
import { parseRoute, type Route } from './shell/routes'
import { DemoProvider } from './state/demo'
import { ToastProvider } from './ui/motion'

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function App() {
  const route = useRoute()
  return (
    <DemoProvider>
      <ToastProvider>
        {route.kind === 'landing' ? (
          <Landing />
        ) : (
          <AppShell side={route.side}>{route.side === 'merchant' ? <MerchantHome /> : <AdminHome />}</AppShell>
        )}
      </ToastProvider>
    </DemoProvider>
  )
}
