## Lutron Caseta Module

This module provides controls for Lutron Caseta Smart Bridges and their connected devices via local APIs.

### Supported Devices

We currently provide support for light switches, dimmers and scenes. Other types of devices can be added if requested.

Known Working Devices

- Caseta Light Switches
- Caseta Light Dimmers
- Caseta Plug-in Lamp Dimmers
- Diva Light Switches
- Diva Light Dimmers

Supported, but not yet tested on hardware

- Caseta Plug-in Switches

Pico remotes can be used as triggers when **Include Pico Remotes** is ticked in the connection configuration (see Pico remotes below). Shades, fans, occupancy sensors and thermostats are not supported.

If you have a device that works with this module but it is not listed, please open an issue to have it added. If you would like to have support added for a device, please open an issue to add support.

### Setup

When first setting up a connection you will need to pair with the Caseta Smart Bridge. The module will attempt to discover available bridges on the network. You can select it from the dropdown in the configuration menu. If your bridge does not appear, and you know the IP address, you can enter the IP address manually. Once you click Save you will have 30 seconds to press the black pairing button on the back of the Smart Bridge device. The module will then complete the pairing and you will see the module is connected. Any supported devices found on the smart bridge will have actions made available for them.

### Actions

**Turn On, Turn Off and Set Brightness** are available for each dimmer. Switches have Turn On and Turn Off only. Actions are labelled with the room name set in the Lutron app followed by the device name.

**Activate Scene** activates a scene that was created in the Lutron app. The scene list is read from the bridge when the connection starts, so restart the connection after adding or renaming a scene. Only scenes that are programmed on the bridge are listed.

### Fade time

Dimmer actions fade over a time in seconds. The module has a **Default Fade Time (seconds)** setting in the connection configuration (0 to 10 seconds, default 4). Each dimmer action has a **Use module default fade time** checkbox that is ticked by default. Untick it to enter a fade time for that action alone.

Actions saved with an earlier version of this module keep the fade time they were saved with.

### Plug-in dimmers in ON/OFF mode

A Caseta plug-in dimmer can be set to ON/OFF mode in the Lutron app so that it can control a load that cannot be dimmed. The bridge still reports it as a dimmer. In this mode:

- Any brightness above 0% turns the device on, and 0% turns it off.
- The fade time is ignored.

### Feedbacks and variables

The module follows the state of each light, including changes made at the wall, in the Lutron app or by a schedule.

- **Light is on** is true while the light level is above 0.
- **Light level compared to value** is true when the level is above, below or equal to a value you choose (0 to 100).
- Each light has a **level** variable (0 to 100), for example `$(lutron-caseta:12345678_level)`. The variable list shows the room and device name. Switches report 0 or 100.
- During a fade, the level and feedbacks show the target level straight away, not the intermediate brightness.

### Pico remotes

Tick **Include Pico Remotes** in the connection configuration to use Pico buttons in Companion. It is off by default. Picos only send button presses, so there are no actions. Remotes that are not assigned to a room are included.

- **Pico button is pressed** is true from the moment the button is pressed until it is released, so it also works for press and hold.
- **last_pico_device**, **last_pico_button** and **last_pico_event** hold the remote name, the button name (as named by the bridge, such as "Button 1") and the event (`Press` or `Release`) of the most recent button event. A Companion trigger can fire when these change.

On the 5-button raise/lower remotes the dropdown also shows what the button is printed as: Button 1 is On (top), Button 2 is Favorite (middle), Button 3 is Off (bottom), Button 4 is Raise and Button 5 is Lower. The 4-button scene remotes show only "Button 1" to "Button 4", numbered from top to bottom, since what those do depends on how they are programmed.

Buttons are identified by the remote's serial number and button number, so renaming a remote in the Lutron app does not break a saved feedback. Restart the connection after adding or renaming a remote to refresh the lists.

### Connection loss

If the connection to the bridge drops, the connection status changes and the module keeps retrying, with longer waits up to 30 seconds. When the bridge is back, the module re-reads its devices and scenes and refreshes all light states, so there is no need to restart the connection.

### Limitations

- Devices and scenes are read when the connection starts and after a reconnect. After adding devices or scenes on the bridge, restart the connection to see them.
