import os
import argparse
from datasets import load_dataset, DatasetDict
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
import torch
from tqdm import tqdm
from huggingface_hub import login

login()

# Configure command line arguments
parser = argparse.ArgumentParser(description="Fine-tune an LLM for bot detection")
parser.add_argument("--model", type=str, default="mistralai/Mistral-7B-Instruct-v0.3", help="Base model to fine-tune")
parser.add_argument("--dataset", type=str, default="aevanua/twibot228", help="Hugging Face dataset name")
parser.add_argument("--output_dir", type=str, default="./results", help="Directory to save model and metrics")
parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
parser.add_argument("--batch_size", type=int, default=4, help="Training batch size")
parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
parser.add_argument("--max_length", type=int, default=1024, help="Maximum sequence length")
args = parser.parse_args()

# Create output directory
os.makedirs(args.output_dir, exist_ok=True)

# Load dataset
print(f"Loading dataset: {args.dataset}")
dataset = load_dataset(args.dataset)

# Create stratified validation split if not already present
if "validation" not in dataset:
    print("No validation split found. Creating stratified 90/10 split based on 'output' column...")
    split_dataset = dataset["train"].train_test_split(
        test_size=0.1,
        seed=42,
        stratify_by_column="output"
    )
    dataset = DatasetDict({
        "train": split_dataset["train"],
        "validation": split_dataset["test"]
    })

print(f"Dataset loaded with {len(dataset['train'])} training examples and {len(dataset['validation'])} validation examples")

# Load tokenizer
print(f"Loading tokenizer for {args.model}")
tokenizer = AutoTokenizer.from_pretrained(args.model)
tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right"

# Format prompts
def format_prompt(example):
    example['text'] = example['input'] + "\n" + example['output']
    return example

print("Formatting dataset for instruction tuning")
formatted_train = dataset['train'].map(format_prompt)
formatted_val = dataset['validation'].map(format_prompt)

# Tokenization
def tokenize_function(examples):
    return tokenizer(
        examples["text"],
        truncation=True,
        max_length=args.max_length,
        padding="max_length",
    )

print("Tokenizing datasets")
tokenized_train = formatted_train.map(tokenize_function, batched=True, remove_columns=["input", "output", "text"])
tokenized_val = formatted_val.map(tokenize_function, batched=True, remove_columns=["input", "output", "text"])

# Load model
print(f"Loading base model: {args.model}")
model = AutoModelForCausalLM.from_pretrained(
    args.model,
    device_map="auto",
    trust_remote_code=True,
    load_in_8bit=True
)

# Optional: prepare model for quantization
if getattr(args, "use_8bit", False) or getattr(args, "use_4bit", False):
    print("Preparing model for quantized training")
    model = prepare_model_for_kbit_training(model)

# Apply LoRA
print("Applying LoRA adapters")
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# Training arguments
training_args = TrainingArguments(
    output_dir=args.output_dir,
    num_train_epochs=args.epochs,
    per_device_train_batch_size=args.batch_size,
    per_device_eval_batch_size=args.batch_size,
    evaluation_strategy="epoch",
    save_strategy="epoch",
    save_total_limit=2,
    learning_rate=args.lr,
    weight_decay=0.01,
    fp16=True,
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
    logging_steps=10,
    report_to="tensorboard",
)

data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_train,
    eval_dataset=tokenized_val,
    data_collator=data_collator,
)

# Train
print("Starting training...")
trainer.train()

# Save model
print(f"Saving model to {args.output_dir}")
trainer.save_model(f"{args.output_dir}/final")
tokenizer.save_pretrained(f"{args.output_dir}/final")

# Evaluate using generation
print("Evaluating model on validation set...")
model.eval()
true_labels = []
pred_labels = []

for example in tqdm(formatted_val):
    prompt = f"""### Instruction:
Analyze the following tweets and determine if they were written by a bot or a human.

### Input:
{example['input']}

### Response:
"""
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True).to(model.device)

    with torch.no_grad():
        outputs = model.generate(**inputs, max_new_tokens=10)

    pred_text = tokenizer.decode(outputs[0], skip_special_tokens=True).strip().upper()
    pred = 1 if "BOT" in pred_text else 0 if "HUMAN" in pred_text else -1
    if pred == -1:
        continue  # skip unknown output

    true = 1 if example['output'].strip().upper() == "BOT" else 0

    pred_labels.append(pred)
    true_labels.append(true)

# Compute metrics
accuracy = accuracy_score(true_labels, pred_labels)
precision = precision_score(true_labels, pred_labels)
recall = recall_score(true_labels, pred_labels)
f1 = f1_score(true_labels, pred_labels)
cm = confusion_matrix(true_labels, pred_labels)

# Print metrics
print("\n=== Evaluation Metrics ===")
print(f"Accuracy:  {accuracy:.4f}")
print(f"Precision: {precision:.4f}")
print(f"Recall:    {recall:.4f}")
print(f"F1-score:  {f1:.4f}")
print("\nConfusion Matrix:")
print(cm)

# Save metrics
metrics_path = os.path.join(args.output_dir, "metrics.txt")
with open(metrics_path, "w") as f:
    f.write("=== Evaluation Metrics ===\n")
    f.write(f"Accuracy:  {accuracy:.4f}\n")
    f.write(f"Precision: {precision:.4f}\n")
    f.write(f"Recall:    {recall:.4f}\n")
    f.write(f"F1-score:  {f1:.4f}\n")
    f.write("\nConfusion Matrix:\n")
    f.write("               Predicted\n")
    f.write("              BOT   HUMAN\n")
    f.write(f"Actual BOT   {cm[1][1]:5d}  {cm[1][0]:5d}\n")
    f.write(f"Actual HUMAN {cm[0][1]:5d}  {cm[0][0]:5d}\n")

print(f"\nMetrics saved to {metrics_path}")
print("Training and evaluation complete!")
