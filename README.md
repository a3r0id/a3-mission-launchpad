# A3 Mission Launchpad

[![Extension CI (main)](https://github.com/a3r0id/a3-mission-launchpad/actions/workflows/extension-ci.yml/badge.svg?branch=main)](https://github.com/a3r0id/a3-mission-launchpad/actions/workflows/extension-ci.yml?query=branch%3Amain)

![Launchpad](launchpad.png)

**Launchpad** is a robust suite of tools to aid Arma 3 mission makers and eventually modders. Launchpad features project organization/resource tracking, scripting, and soft-profiling - both in-game and out. There is a lot of tooling out there for mod makers; This project focuses on **mission makers**, at least to begin with. The main purpose of Launchpad is to fill the gap that Arma 3 Tools and 3Den lack, that Enfusion showed us. 

---

## Installing Launchpad

Install Launchpad via a cross-platform installer or build from source. For more info see [Installation](docs/INSTALLATION.md).
- **Download a release** — Install a release from the [releases](/releases) page.
- **Build from source** — Clone the project, run `cd a3-mission-launchpad ** python3 util.py --build --install`.

---

## Quick start

### Create a new mission

1. Start Launchpad (double-click the packaged executable, or `python -m launchpad_server` from the repo if you are developing).
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

## Need help?

Open an issue on [GitHub](https://github.com/a3r0id/a3-mission-launchpad/issues) for bugs, questions, or ideas. Include what you tried and what you expected to happen—that makes it much easier to help.
