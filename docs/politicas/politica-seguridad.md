# Políticas de Seguridad de SalesStock Pro

## 1. Autenticación

### 1.1 Requisitos de contraseña
- Mínimo 8 caracteres
- Al menos un número
- Al menos una letra mayúscula
- Al menos un símbolo
- No se permiten contraseñas repetidas (últimas 3)

### 1.2 Sesiones
- Persistencia LOCAL (dispositivo actual)
- Timeout de inactividad: 30 minutos
- Cierre de seguridad automático al cerrar pestaña

### 1.3 Acceso por rol
- **Super Admin** (Sistemapro): acceso completo
- **Admin de licencia**: acceso a su empresa (products, sales, fiados, users)
- **Invitado**: solo lectura de reportes

## 2. Autorización

### 2.1 Company isolation
- Cada usuario pertenece a una `companyId` (UUID)
- Los productos, ventas y créditos se filtran automáticamente por `companyId`
- Un admin no puede ver datos de otra empresa

### 2.2 Permisos por colección
| Colección | Super Admin | Admin Licencia | Invitado |
|-----------|-------------|----------------|----------|
| products  | CRUD        | CRUD           | Read     |
| sales     | CRUD        | CRUD           | Read     |
| fiados    | CRUD        | CRUD           | Read     |
| users     | CRUD        | CRUD (solo su empresa) | Read |
| licenses  | CRUD        | Read           | Deny     |

## 3. Protección de datos

### 3.1 Almacenamiento
- Datos sensibles (contraseñas) nunca se almacenan en Firestore
- Contraseñas se hashean con SHA-256 antes de verificar
- Tokens de Firebase App Check requeridos para todas las operaciones

### 3.2 Sanitización
- Todos los nombres de productos se sanitizan con `escapeHtml()` antes de guardar
- Códigos de barras solo permiten caracteres alfanuméricos y guiones
- Nombres de usuarios validados con regex `^[a-zA-Z0-9_]+$`

## 4. Comunicación

### 4.1 HTTPS obligatorio
- Todo el tráfico va por HTTPS
- HSTS habilitado (max-age: 63072000)

### 4.2 Content Security Policy
- `default-src 'self'`
- `script-src` limitado a CDN permitido
- `connect-src` limitado a endpoints de Firebase
- `frame-src` limitado a accounts.google.com y firebaseapp.com

## 5. Auditoría

### 5.1 Registro de actividades
- Cada operación (create, update, delete) se registra con:
  - Acción realizada
  - Colección afectada
  - ID del documento
  - UID del usuario
  - Timestamp

### 5.2 Revisión
- Los logs de auditoría se revisan semanalmente
- Alertas automáticas por actividades sospechosas (ej: eliminación masiva)

## 6. Manejo de incidentes

### 6.1 Reporte
- Cualquier sospecha de violación de seguridad debe reportarse inmediatamente
- Contacto: security@salesstock.local

### 6.2 Contención
- Bloqueo de cuenta sospechosa
- Revocación de tokens de Firebase
- Auditoría de actividad reciente

## 7. Cumplimiento

Este sistema cumple con:
- LGPD (Brasil): datos de clientes protegidos
- LOPDGDD (España): consentimiento explícito para tratamiento de datos
- GDPR (UE): derecho al olvido, portabilidad de datos

## 8. Responsables

- **Propietario del sistema**: Sistemapro
- **Encargado de seguridad**: Admin principal de cada licencia
- **Soporte técnico**: soporte@salesstock.local

---

*Última actualización: 2026-10-08*
*Versión: 1.0*