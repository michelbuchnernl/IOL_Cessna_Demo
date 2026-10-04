# AR: een gedeelde ruimte uitlijnen met een fysiek anker

Status: idee van 2026-10-04, nog niet gebouwd. Wat hieronder staat over browserfuncties moet eerst op de Quest 3S worden gecontroleerd.

## Het idee

Zes leerlingen staan rond een model. Een fysiek anker (bijvoorbeeld een kubus met op elke zijde een eigen QR-code) levert het gemeenschappelijke nulpunt. Elke headset berekent waar het anker staat in zijn eigen tracking-ruimte, en zet de virtuele objecten daarop. Zo staan het object en de specialist bij iedereen op dezelfde plek in de echte ruimte.

Het principe is goed. De vraag is welke manier van detecteren in de browser beschikbaar is.

## Opties

| Optie | Werkt in Quest Browser? | Quest 2 | Opmerking |
|---|---|---|---|
| QR/AprilTag via camerabeeld (WebXR `camera-access`) | **Controleren.** Voor zover bekend niet beschikbaar in Quest Browser. | Nee (zwart-wit passthrough) | Meta biedt dit wel in native apps (Passthrough Camera API, Quest 3/3S). |
| Twee-punts kalibratie met de controller | Ja, geen speciale functie nodig | Ja | Raak punt A en punt B aan op de kubus of een markering op tafel en druk op een knop. Geeft positie en draairichting, nauwkeurig tot ongeveer 1 tot 2 cm. |
| WebXR anchors (lokaal bewaren) | Controleren | Waarschijnlijk | Houdt de uitlijning vast bij herstarten van de tracking. Anchors worden niet tussen apparaten gedeeld. |
| Meta Shared Spatial Anchors | Alleen native | n.v.t. | Niet via de browser. |

## Voorstel

1. **Eerst meten wat de Quest 3S in de browser toestaat.** Een testpagina die `immersive-ar` start met `camera-access`, `anchors`, `plane-detection` en `image-tracking` als optionele functies en toont wat `session.enabledFeatures` teruggeeft. Dit duurt een kwartier en beslist de route.
2. **Twee-punts controllerkalibratie bouwen.** Werkt overal, ook op Quest 2, en vervangt de huidige "Calibrate" die op de kijkrichting van het hoofd leunt.
3. **Alleen als `camera-access` beschikbaar blijkt:** QR-detectie op camerabeelden (bijvoorbeeld jsQR of een AprilTag-bibliotheek) met de kubus als anker. Een kubus met zes codes zorgt dat elke leerling er vanuit zijn positie minstens één ziet.

## Gevolgen voor de app

- In AR moet de ruimte-schil verborgen zijn, zodat alleen het object en de video's over de echte ruimte liggen. Dat staat nu in de ervaring als `environment.hideInAr`.
- Quest 2 toont de echte wereld in lage kwaliteit zwart-wit. Quest 3S is in kleur. Voor een klas met gemengde apparaten blijft VR in de kleine ruimte daarom de veilige basis.
