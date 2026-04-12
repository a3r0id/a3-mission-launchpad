# Installation Instructions

This document will guide you through setting up the development environment for Python and how to use the portable binary of the application.

## Python Development Setup

1. **Prerequisites**: Ensure you have Python 3.8+ installed on your machine. You can download it from [python.org](https://www.python.org/downloads/).
2. **Clone the Repository**: Run the following command to clone the repo to your local machine.
   ```bash
   git clone https://github.com/a3r0id/a3-mission-launchpad.git
   cd a3-mission-launchpad
   ```
3. **Create a Virtual Environment**: It’s recommended to use a virtual environment. You can create one using:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```
4. **Install Dependencies**: Once the virtual environment is activated, install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```
5. **Run the Application**: You can start the application with:
   ```bash
   python main.py
   ```

## Portable Binary Usage

For users who prefer not to set up a development environment, a portable binary is available.
1. **Download the Portable Binary**: The latest binary can be downloaded from the [releases page](https://github.com/a3r0id/a3-mission-launchpad/releases).
2. **Run the Binary**: After downloading, you can run the application directly. Ensure that you have the necessary permissions to execute the file. Simply run:
   ```bash
   ./a3-mission-launchpad  # Modify with the correct name of the binary
   ```

---

Feel free to reach out if you encounter any issues or have questions!