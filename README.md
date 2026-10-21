# SalesStock Pro

Sistema de gestión de ventas e inventario con autenticación y base de datos en la nube (Firebase).

## Características

- Login con correo/contraseña y con Google (Firebase Auth)
- Productos, ventas, cotizaciones y fiados sincronizados entre dispositivos (Firestore)
- Generación de facturas en PDF, códigos de barras y etiquetas
- PWA instalable (manifest + service worker)

## Estructura

```
.
├── index.html
├── app.js                  # Lógica principal de la interfaz
├── styles.css
├── firebase-config.js      # Credenciales de Firebase (editar con tu proyecto)
├── manifest.json           # Configuración PWA
├── sw.js                   # Service worker (caché offline)
├── firebase.json           # Config de Firebase Hosting
├── firestore.rules         # Reglas de seguridad de Firestore
├── firestore.indexes.json
├── package.json
├── js/
│   ├── services/
│   │   ├── db.js                    # Capa de datos Firestore
│   │   └── firebase-auth.service.js # Autenticación Firebase
│   └── utils/
│       └── formatters.js
└── tests/
    └── app.test.js
```

## Configuración

1. Crea un proyecto en [Firebase](https://console.firebase.google.com).
2. Habilita **Authentication** (Correo/contraseña y Google) y **Firestore Database**.
3. En `firebase-config.js` pega las credenciales de tu app web (`firebaseConfig`).
4. En Authentication → Settings → Authorized domains, agrega tu dominio (ej. `localhost`, `tudominio.vercel.app`).
5. Despliega las reglas: `firebase deploy --only firestore:rules`.

## Despliegue

- **Vercel:** importa el repositorio desde GitHub (sin build command, output en la raíz).
- **Firebase Hosting:** `firebase deploy --only hosting`.

## Pruebas

```bash
npm install
npm test
```

## Uso local

Sirve la carpeta con cualquier servidor estático (Firebase bloquea `file://`):

```bash
npx serve .
```
