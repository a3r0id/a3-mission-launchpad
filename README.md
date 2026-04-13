# A3 Mission Launchpad

![Launchpad](launchpad.png)

**Launchpad** is a desktop app that helps you build and organize **Arma 3 missions** (the game calls them *scenarios* in some menus). There is a lot of tooling out there for mod makers; this project focuses on **mission makers** who want a clearer folder layout, repeatable builds, and a simple UI instead of juggling scripts by hand.

If you are new here: you do **not** need to be a programmer to use the packaged app. If you want to change the app itself or run from source, the [installation guide](docs/INSTALLATION.md) walks through Python, a virtual environment, and running `python main.py`.

---

## Get set up first

Before the steps below, install Launchpad using whichever path fits you:

- **Download a release** — easiest if you just want the app: see [releases](https://github.com/a3r0id/a3-mission-launchpad/releases) and the “portable binary” section in [Installation](docs/INSTALLATION.md).
- **Run from this repo** — clone the project, create a venv, `pip install -r requirements.txt`, then run `python main.py` from the project root (details in [Installation](docs/INSTALLATION.md)).

---

## Quick start (after Launchpad is running)

### Create a new mission

1. Start Launchpad (double-click the executable, or `python main.py` if you are developing).
2. In the main menu, choose **Create New Scenario**.
3. Fill in the form and confirm.
4. Your mission shows up under **Managed Missions**.

### Open and edit a mission

1. Start Launchpad if it is not already open.
2. Open **Managed Missions** and pick your scenario.
3. Adjust settings and macros in the main view.
4. Use the resource browser to open files in your own editor (VS Code, Notepad++, etc.).

### Put the mission on GitHub

1. Open **Managed Missions** and select your scenario.
2. Click **Add Project to GitHub** and follow the prompts.
3. When it succeeds, the version control area updates with your repo.

### Run tests

1. Open **Managed Missions** and select your scenario.
2. Open the **Testing** tab and run the checks for your project.

---

## What you get

- A **build workflow** aimed at Arma 3 scenarios, not generic “some folder of files.”
- **Consistent project layout** so missions stay easier to navigate and hand off.
- A **testing** tab so you can catch issues without only relying on in-game trial and error.
- **GitHub integration** when you are ready for backups and collaboration.
- A **graphical interface** so common tasks do not depend on memorizing commands.

---

## Need help?

Open an issue on [GitHub](https://github.com/a3r0id/a3-mission-launchpad/issues) for bugs, questions, or ideas. Include what you tried and what you expected to happen—that makes it much easier to help.
