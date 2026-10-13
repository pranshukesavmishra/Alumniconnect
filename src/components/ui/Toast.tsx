import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react'
import { Toaster } from 'sonner'
import { useTheme } from '../../lib/theme'

/** The app's toaster: glass cards, brand icons, follows the theme. Mounted once in main.tsx. Use `toast()` from sonner as before. */
export function AppToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      position="top-center"
      richColors={false}
      closeButton
      theme={resolved}
      offset={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      icons={{
        success: <CheckCircle2 className="size-5" />,
        error: <AlertCircle className="size-5" />,
        warning: <TriangleAlert className="size-5" />,
        info: <Info className="size-5" />,
        loading: <Loader2 className="size-5 animate-spin" />,
      }}
      toastOptions={{ style: { fontFamily: 'inherit' } }}
    />
  )
}
