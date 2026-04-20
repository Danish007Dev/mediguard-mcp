#!/bin/bash

# Daily Progress Tracker for MediGuard MCP
# Run this at the end of each day to track progress

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%A)
DAYS_UNTIL_DEADLINE=$(( ( $(date -d "2026-05-11" +%s) - $(date +%s) ) / 86400 ))

echo -e "${BLUE}==================================${NC}"
echo -e "${BLUE}  Daily Progress - $DAY_OF_WEEK, $DATE${NC}"
echo -e "${BLUE}  Days until deadline: $DAYS_UNTIL_DEADLINE${NC}"
echo -e "${BLUE}==================================${NC}"
echo ""

# Function to calculate percentage
calc_percentage() {
    local completed=$1
    local total=$2
    echo "scale=1; ($completed / $total) * 100" | bc
}

# Check git status
echo -e "${YELLOW}Git Status:${NC}"
echo "  Commits today: $(git log --since='midnight' --oneline | wc -l)"
echo "  Files changed: $(git diff --name-only | wc -l)"
echo ""

# Check test status
echo -e "${YELLOW}Test Status:${NC}"
if [ -f "coverage/lcov-report/index.html" ]; then
    COVERAGE=$(grep -oP 'headerCovTableEntryLo.*?>\K\d+\.\d+' coverage/lcov-report/index.html | head -1)
    echo "  Coverage: ${COVERAGE}%"
else
    echo "  Coverage: Not available (run npm test)"
fi
echo ""

# Check phase progress
echo -e "${YELLOW}Phase Progress:${NC}"

# Count completed tasks in roadmap
TOTAL_CHECKBOXES=$(grep -c '\[ \]' .github/PROJECT_ROADMAP.md 2>/dev/null || echo "0")
COMPLETED_CHECKBOXES=$(grep -c '\[x\]' .github/PROJECT_ROADMAP.md 2>/dev/null || echo "0")

if [ "$TOTAL_CHECKBOXES" -gt 0 ]; then
    PROGRESS=$(calc_percentage $COMPLETED_CHECKBOXES $TOTAL_CHECKBOXES)
    echo "  Overall: ${COMPLETED_CHECKBOXES}/${TOTAL_CHECKBOXES} tasks (${PROGRESS}%)"
else
    echo "  Overall: Not tracking (update PROJECT_ROADMAP.md)"
fi
echo ""

# Check tool implementation
echo -e "${YELLOW}Tool Implementation:${NC}"
TOOLS=("check_drug_interactions" "analyze_polypharmacy" "check_contraindications" "get_safer_alternatives" "explain_medication_safety")

for tool in "${TOOLS[@]}"; do
    if grep -q "function $tool\|const $tool" src/tools/*.ts 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $tool"
    else
        echo -e "  ⬜ $tool"
    fi
done
echo ""

# Lines of code
echo -e "${YELLOW}Code Statistics:${NC}"
if [ -d "src" ]; then
    TOTAL_LINES=$(find src -name '*.ts' -exec wc -l {} + | tail -1 | awk '{print $1}')
    echo "  Total lines: $TOTAL_LINES"
    echo "  Files: $(find src -name '*.ts' | wc -l)"
fi
echo ""

# Next milestone
echo -e "${YELLOW}Next Milestone:${NC}"
if [ $DAYS_UNTIL_DEADLINE -gt 14 ]; then
    echo "  Focus: Phase 1-2 (Foundation & Core Tools)"
elif [ $DAYS_UNTIL_DEADLINE -gt 7 ]; then
    echo "  Focus: Phase 3-4 (FHIR Integration & Testing)"
elif [ $DAYS_UNTIL_DEADLINE -gt 3 ]; then
    echo "  Focus: Phase 5-6 (Intelligence & Marketplace)"
else
    echo "  Focus: Phase 7 (Demo Video & Submission)"
fi
echo ""

# Motivational message
if [ $DAYS_UNTIL_DEADLINE -le 5 ]; then
    echo -e "${YELLOW}⚡ Final push! You've got this!${NC}"
elif [ $DAYS_UNTIL_DEADLINE -le 10 ]; then
    echo -e "${YELLOW}🎯 Entering the home stretch - stay focused!${NC}"
else
    echo -e "${GREEN}💪 Keep up the great work!${NC}"
fi
echo ""

# Prompt for daily notes
echo -e "${BLUE}Quick daily update (or press Enter to skip):${NC}"
read -p "What did you accomplish today? " ACCOMPLISHMENT
read -p "Any blockers? " BLOCKERS
read -p "Tomorrow's goal? " TOMORROW

# Save to log file
if [ ! -z "$ACCOMPLISHMENT" ]; then
    LOG_FILE=".github/progress-log.md"
    
    if [ ! -f "$LOG_FILE" ]; then
        echo "# MediGuard MCP - Daily Progress Log" > $LOG_FILE
        echo "" >> $LOG_FILE
    fi
    
    echo "## $DATE - $DAY_OF_WEEK (Day $(( 21 - $DAYS_UNTIL_DEADLINE ))/21)" >> $LOG_FILE
    echo "" >> $LOG_FILE
    echo "**Accomplished:** $ACCOMPLISHMENT" >> $LOG_FILE
    [ ! -z "$BLOCKERS" ] && echo "**Blockers:** $BLOCKERS" >> $LOG_FILE
    [ ! -z "$TOMORROW" ] && echo "**Tomorrow:** $TOMORROW" >> $LOG_FILE
    echo "**Commits:** $(git log --since='midnight' --oneline | wc -l)" >> $LOG_FILE
    echo "" >> $LOG_FILE
    
    echo -e "${GREEN}✓ Progress logged to $LOG_FILE${NC}"
fi

echo ""
echo -e "${BLUE}Keep going - every day counts! 🚀${NC}"
