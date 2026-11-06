import requests
import json
import os
import sys
from datetime import datetime

# Fix Unicode output for Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())

class AgentRunner:
    def __init__(self):
        self.model = 'tinyllama:latest'  # Changed to local model
        self.url = 'http://localhost:11434/api/chat'  # Changed to local Ollama
        self.history_file = 'agent_conversation_history.json'
        self.agents = []
        self.tasks = []
        self.status = {}
        self.app_settings = {
            'autoSync': True,
            'updateCheck': True,
            'appTracking': True,
            'statePersistence': True,
            'resetEnabled': True,
            'resetConnectedApps': True
        }
        self.usage_logs = []
        self.load_state()
    
    def load_state(self):
        if os.path.exists(self.history_file):
            with open(self.history_file, 'r') as f:
                state = json.load(f)
                self.agents = state.get('agents', [])
                self.tasks = state.get('tasks', [])
                self.status = state.get('status', {})
                self.usage_logs = state.get('usage_logs', [])
                self.app_settings = state.get('app_settings', self.app_settings)
    
    def save_state(self):
        state = {
            'agents': self.agents,
            'tasks': self.tasks,
            'status': self.status,
            'usage_logs': self.usage_logs,
            'app_settings': self.app_settings
        }
        with open(self.history_file, 'w') as f:
            json.dump(state, f, indent=2)
    
    def run_qwen_agent(self, prompt, task_id=None):
        messages = [
            {'role': 'system', 'content': 'You are an AI assistant for implementing automation engine features. Output only valid TypeScript code without markdown code blocks.'}
        ]
        
        for log in self.usage_logs:
            if 'user' in log and 'assistant' in log:
                messages.append({'role': 'user', 'content': log['user']})
                messages.append({'role': 'assistant', 'content': log['assistant']})
        
        messages.append({'role': 'user', 'content': prompt})
        
        body = {
            'model': self.model,
            'messages': messages,
            'stream': False
        }
        
        try:
            response = requests.post(self.url, json=body, timeout=120)
            response.raise_for_status()
            data = response.json()
            full_content = data['message']['content']
            
            self.usage_logs.append({
                'user': prompt,
                'assistant': full_content,
                'timestamp': str(datetime.now()),
                'task_id': task_id
            })
            self.save_state()
            
            return full_content
        except Exception as e:
            return f'Error: {str(e)}'
    
    def reset_state(self):
        self.agents = []
        self.tasks = []
        self.status = {}
        self.usage_logs = []
        self.save_state()
        print('State reset complete.')
        
    def run_task(self, task_id, task_description):
        print(f'Running task {task_id}: {task_description}')
        
        prompt = f'''Implement the following feature for the Complete Automation Engine:

Task ID: {task_id}
Task: {task_description}

Create a complete implementation file in src/automation/complete-automation-engine/

Requirements:
1. Follow TypeScript best practices
2. Include proper type definitions
3. Add comprehensive inline comments
4. Handle errors gracefully
5. Include example usage in comments
6. Output ONLY valid TypeScript code without markdown code blocks

Return a summary of:
- Files created
- Key features implemented
- Any issues encountered
'''
        
        result = self.run_qwen_agent(prompt, task_id)
        print(f'Task {task_id} completed.')
        print(f'Result: {result[:500]}...')
        return result

def main():
    print('Starting Qwen Agent Runner...')
    
    runner = AgentRunner()
    
    # Run key tasks
    tasks = [
        ('6.2', 'Implement Recording?Workflow integration - Emit WorkflowCreatedEvent when recording completes'),
        ('6.3', 'Implement Workflow?Pack integration - Validate workflow compatibility when adding to pack'),
        ('6.4', 'Implement Pack execution feedback loop - Consume ExecutionCompleteEvent from pack deployments'),
        ('6.5', 'Implement Habit?Pack suggestion integration - Suggest relevant packs when habits match context'),
        ('7.4', 'Implement Execution repository and archiving - Save workflow and pack execution records'),
    ]
    
    for task_id, task_desc in tasks:
        runner.run_task(task_id, task_desc)
        print('---')
    
    print('All tasks completed.')

if __name__ == '__main__':
    main()
