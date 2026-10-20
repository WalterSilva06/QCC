// Abrir la carpeta de la sesión en el explorador. Puro: sin `$`, para poder probarlo solo.

export type SistemaCarpeta = 'windows' | 'mac' | 'otro'

/**
 * Qué clase de ruta absoluta es; `null` si no sirve para abrirla:
 * vacía, relativa, que empiece con `-` o con caracteres de control.
 */
export function tipoDeRuta(ruta: string): 'windows' | 'posix' | null {
  if (/[\u0000-\u001f\u007f]/.test(ruta)) return null
  if (/^[A-Za-z]:[\\/]/.test(ruta) || /^\\\\[^\\]/.test(ruta)) return 'windows'
  if (ruta.startsWith('/')) return 'posix'

  return null
}

/**
 * Windows, sin la ruta (sale de la carpeta de trabajo): cierra las ventanas ocultas de esa
 * carpeta y la abre con el Explorador que ya corre.
 */
const ABRIR_EN_WINDOWS = [
  '$s = New-Object -ComObject Shell.Application',
  '$p = (Get-Location).ProviderPath',
  '@($s.Windows()) | Where-Object { -not $_.Visible -and $(try { $_.Document.Folder.Self.Path -eq $p } catch { $false }) } | ForEach-Object { $_.Quit() }',
  '$s.Open($p)',
].join('; ')

/**
 * El comando que abre la carpeta de trabajo (`.`) en cada sistema; la ruta va como `cwd`.
 *
 * En Windows no sirve `explorer.exe .`: el motor lanza los procesos con la ventana oculta
 * y el Explorador nuevo la hereda. `Shell.Application.Open` le pide la ventana al
 * Explorador que ya corre, que la muestra normal; pero si ya hay una ventana oculta de
 * esa carpeta, la reutiliza y no se ve nada. Por eso antes se cierran las ocultas.
 */
export function comandoCarpeta(sistema: SistemaCarpeta): string[] {
  if (sistema === 'windows') return ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', ABRIR_EN_WINDOWS]
  if (sistema === 'mac') return ['open', '.']

  return ['xdg-open', '.']
}
