# Firma de código (pendiente, aparcado)

Hoy el instalador y la versión portable de las apps Búho (Excel, DiskScanner) **no están firmados** con certificado de código. Consecuencias:

- «Buho Corps Systems» sí aparece como editor en Programas instalados, en las propiedades del ejecutable y en el copyright.
- Windows SmartScreen puede avisar la primera vez en otros PCs («Editor desconocido»): se pasa con **Más información → Ejecutar de todas formas**.

## Opciones (precios aproximados, octubre 2026, sin verificar tarifas actuales)

| Opción | Precio | Notas |
|---|---|---|
| **Azure Trusted Signing** (Microsoft) | ~10 $/mes | La más barata y cómoda: firma en la nube, sin llave USB. Requiere verificar la empresa/autónomo; confirmar disponibilidad en España. **Recomendada.** |
| Certificado OV (Sectigo, SSL.com, Certum…) | ~200–400 €/año | Desde 2023 obliga a guardarlo en llave USB (HSM) o servicio en la nube, con coste extra. |
| Certificado EV | ~300–600 €/año | Ya no quita el aviso de SmartScreen desde el primer día: hoy no compensa. |

Con cualquiera, el aviso de SmartScreen desaparece del todo cuando el instalador acumula reputación (descargas).

## Cuando se retome

- electron-builder firma solo si se le dan las credenciales (`win.azureSignOptions` para Azure Trusted Signing, o `CSC_LINK` / `CSC_KEY_PASSWORD` para un .pfx).
- Firmar `BuhoExcel.exe`, el instalador y el desinstalador; la versión portable sale de la misma carpeta firmada.
