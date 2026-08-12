# Assinatura dos instaladores Windows

Os instaladores do VoiceUP podem ser assinados automaticamente pelo GitHub Actions depois de configurar um certificado Authenticode válido.

## O que é necessário

1. Um certificado de assinatura de código emitido por uma autoridade certificadora confiável.
2. O certificado no formato `.pfx`, convertido para Base64.
3. Dois secrets no repositório GitHub:
   - `WINDOWS_CERTIFICATE`: conteúdo Base64 do arquivo `.pfx`.
   - `WINDOWS_CERTIFICATE_PASSWORD`: senha do certificado.

O fluxo de Release já lê esses secrets. Sem eles, o projeto continua compilando, mas o Windows mostra o publicador como desconhecido.

## Importante sobre SmartScreen

Assinar identifica o publicador verificado que consta no certificado (use a identidade `Goat Gank` ao solicitar o certificado) e permite que a reputação seja acumulada entre as versões assinadas pelo mesmo certificado. Mesmo assim, versões novas podem exibir aviso no início. Não use certificados autoassinados para distribuição pública.

Para eliminar de forma confiável o aviso em instalações públicas, publique o app pela Microsoft Store; ela assina a distribuição com certificado Microsoft.
