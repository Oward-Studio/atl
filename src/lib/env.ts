/**
 * Reading a switch from the environment.
 *
 * `=0` and `=''` mean off, which is what someone writing `ATL_UPDATE_CHECK=0` in a
 * wrapper script intends. Bare truthiness would read both as on and hand a CI job the
 * network call it was trying to avoid.
 */
export function flag(name: string): boolean {
  const value = process.env[name]
  return value !== undefined && value !== '' && value !== '0'
}
