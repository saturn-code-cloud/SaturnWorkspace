import type { AnchorHTMLAttributes } from 'react'
import { routeToPath } from '../../app/productionRouter'
import type { AppRoute, Navigate } from '../../app/routes'

type RouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  route: AppRoute
  navigate: Navigate
}

export function RouteLink({ route, navigate, onClick, ...props }: RouteLinkProps) {
  return <a {...props} href={routeToPath(route)} onClick={(event) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || props.download != null || (props.target && props.target !== '_self')) return
    event.preventDefault()
    navigate(route)
  }} />
}
