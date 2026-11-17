"""Encode Chinese queries and memories locally with BGE-small-zh-v1.5."""
import base64
import json
import os
from pathlib import Path
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

root = Path(os.environ["WHALE_BGE_DIR"])
tokenizer = Tokenizer.from_file(str(root / "tokenizer.json"))
tokenizer.enable_truncation(max_length=512)
tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(root / "model.onnx"), options, providers=["CPUExecutionProvider"])
fields = {"input_ids": "ids", "attention_mask": "attention_mask", "token_type_ids": "type_ids"}

for line in sys.stdin:
    try:
        request = json.loads(line)
        texts = request["texts"]
        if request.get("query"):
            texts = ["为这个句子生成表示以用于检索相关文章：" + text for text in texts]
        encoded = tokenizer.encode_batch(texts)
        inputs = {node.name: np.asarray([getattr(item, fields[node.name]) for item in encoded], dtype=np.int64)
                  for node in session.get_inputs()}
        # The BGE model card specifies the CLS token and L2 normalization.
        vectors = session.run(None, inputs)[0][:, 0, :]
        vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
        print(json.dumps([base64.b64encode(v.astype("<f4").tobytes()).decode("ascii") for v in vectors]), flush=True)
    except Exception:
        print("null", flush=True)
