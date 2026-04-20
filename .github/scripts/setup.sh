#!/bin/bash

# MediGuard MCP - Development Helper Scripts

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}==================================${NC}"
echo -e "${GREEN}  MediGuard MCP - Quick Setup     ${NC}"
echo -e "${GREEN}==================================${NC}"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js
echo -e "${YELLOW}Checking Node.js...${NC}"
if command_exists node; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js installed: $NODE_VERSION${NC}"
    
    # Check if version is 18+
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        echo -e "${RED}✗ Node.js 18+ required. Current: $NODE_VERSION${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

# Check npm
echo -e "${YELLOW}Checking npm...${NC}"
if command_exists npm; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓ npm installed: $NPM_VERSION${NC}"
else
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi

# Install dependencies
echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${RED}✗ Failed to install dependencies${NC}"
    exit 1
fi

# Set up environment file
echo ""
echo -e "${YELLOW}Setting up environment file...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo -e "${YELLOW}⚠ Please edit .env and add your ANTHROPIC_API_KEY${NC}"
else
    echo -e "${YELLOW}⚠ .env file already exists, skipping${NC}"
fi

# Build the project
echo ""
echo -e "${YELLOW}Building project...${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

# Run tests
echo ""
echo -e "${YELLOW}Running tests...${NC}"
npm test

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Tests passed${NC}"
else
    echo -e "${YELLOW}⚠ Some tests failed - this is normal for new setup${NC}"
fi

# Final instructions
echo ""
echo -e "${GREEN}==================================${NC}"
echo -e "${GREEN}  Setup Complete!                 ${NC}"
echo -e "${GREEN}==================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. ${YELLOW}Edit .env${NC} and add your Anthropic API key"
echo -e "  2. ${YELLOW}npm start${NC} to run the MCP server"
echo -e "  3. ${YELLOW}npm test${NC} to run tests"
echo -e "  4. Check ${YELLOW}.github/PROJECT_ROADMAP.md${NC} for development plan"
echo ""
echo -e "Quick commands:"
echo -e "  ${GREEN}npm run dev${NC}     - Run in development mode"
echo -e "  ${GREEN}npm run build${NC}   - Build for production"
echo -e "  ${GREEN}npm test${NC}        - Run all tests"
echo -e "  ${GREEN}npm run lint${NC}    - Check code style"
echo ""
echo -e "Happy coding! 🚀"
