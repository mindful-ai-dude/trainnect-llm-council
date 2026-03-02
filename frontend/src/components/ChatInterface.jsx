import StageTimer from './StageTimer';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import SearchContext from './SearchContext';
import Stage1, { Stage1Skeleton } from './Stage1';
import Stage2, { Stage2Skeleton } from './Stage2';
import Stage3, { Stage3Skeleton } from './Stage3';
import CouncilGrid from './CouncilGrid';
import ExecutionModeToggle from './ExecutionModeToggle';
import { api } from '../api';
import './ChatInterface.css';

// Paperclip icon SVG component
const PaperclipIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
);

// File icon based on type
const FileIcon = ({ type }) => {
    switch (type) {
        case 'pdf':
            return <span>📄</span>;
        case 'csv':
            return <span>📊</span>;
        case 'markdown':
            return <span>📝</span>;
        default:
            return <span>📃</span>;
    }
};

export default function ChatInterface({
    conversation,
    onSendMessage,
    onAbort,
    isLoading,
    councilConfigured,
    onOpenSettings,
    councilModels = [],
    chairmanModel = null,
    executionMode,
    onExecutionModeChange,
    searchProvider = 'duckduckgo',
}) {
    const [input, setInput] = useState('');
    const [webSearch, setWebSearch] = useState(false);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Only auto-scroll if user is already near the bottom
    // This prevents interrupting reading when new content arrives
    useEffect(() => {
        if (!messagesContainerRef.current) return;

        const container = messagesContainerRef.current;
        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 150;

        // Auto-scroll only if user is already at/near bottom
        if (isNearBottom) {
            scrollToBottom();
        }
    }, [conversation]);

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = ['.pdf', '.md', '.markdown', '.csv', '.txt', '.text'];
        const fileName = file.name.toLowerCase();
        const isAllowed = allowedTypes.some(ext => fileName.endsWith(ext));
        
        if (!isAllowed) {
            alert(`File type not allowed. Allowed types: PDF, Markdown, CSV, TXT`);
            return;
        }

        // Validate file size (10MB)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('File too large. Maximum size is 10MB.');
            return;
        }

        setIsUploading(true);
        try {
            const result = await api.uploadFile(file);
            setUploadedFile({
                name: file.name,
                type: result.file_type,
                content: result.content,
                size: file.size,
            });
        } catch (error) {
            console.error('File upload error:', error);
            alert(`Failed to upload file: ${error.message}`);
        } finally {
            setIsUploading(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleFileRemove = () => {
        setUploadedFile(null);
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if ((input.trim() || uploadedFile) && !isLoading) {
            onSendMessage(input, webSearch, uploadedFile);
            setInput('');
            setUploadedFile(null);
        }
    };

    const handleKeyDown = (e) => {
        // Submit on Enter (without Shift)
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    if (!conversation) {
        return (
            <div className="chat-interface">
                <div className="empty-state">
                    <h1>Trainnect LLM Council <span className="plus-text">Plus</span></h1>
                    <p className="hero-message">
                        The Council is ready to deliberate. <button className="config-link" onClick={() => onOpenSettings('council')}>Configure it</button>
                    </p>

                    {/* Council Preview Grid */}
                    <div className="welcome-grid-container">
                        <CouncilGrid models={councilModels} chairman={chairmanModel} status="idle" />
                    </div>

                </div>
            </div>
        );
    }

    return (
        <div className="chat-interface">
            {/* Messages Area */}
            <div className="messages-area" ref={messagesContainerRef}>
                {(!conversation || conversation.messages.length === 0) ? (
                    <div className="hero-container">
                        <div className="hero-content">
                            <h1>Trainnect LLM Council <span className="text-gradient">Plus</span></h1>
                            <p className="hero-subtitle">
                                The Council is ready to deliberate. <button className="config-link" onClick={() => onOpenSettings('council')}>Configure it</button>
                            </p>
                            <div className="welcome-grid-container">
                                <CouncilGrid models={councilModels} chairman={chairmanModel} status="idle" />
                            </div>
                        </div>
                    </div>
                ) : (
                    conversation.messages.map((msg, index) => (
                        <div key={`${conversation.id}-msg-${index}`} className={`message ${msg.role}`}>
                            <div className="message-role">
                                {msg.role === 'user' ? 'Your Question to the Council' : 'LLM Council'}
                            </div>

                            <div className="message-content">
                                {msg.role === 'user' ? (
                                    <div className="markdown-content">
                                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <>
                                        {/* Search Loading */}
                                        {msg.loading?.search && (
                                            <div className="stage-loading">
                                                <div className="spinner"></div>
                                                <span>
                                                    🔍 Searching the web with {
                                                        searchProvider === 'duckduckgo' ? 'DuckDuckGo' :
                                                            searchProvider === 'tavily' ? 'Tavily' :
                                                                searchProvider === 'brave' ? 'Brave' :
                                                                    'Provider'
                                                    }...
                                                </span>
                                            </div>
                                        )}

                                        {/* Search Context */}
                                        {msg.metadata?.search_context && (
                                            <SearchContext
                                                searchQuery={msg.metadata?.search_query}
                                                extractedQuery={msg.metadata?.extracted_query}
                                                searchContext={msg.metadata?.search_context}
                                            />
                                        )}

                                        {/* Stage 1: Council Grid Visualization */}
                                        {(msg.loading?.stage1 || (msg.stage1 && !msg.stage2)) && (
                                            <div className="stage-container">
                                                <div className="stage-header">
                                                    <h3>Stage 1: Council Deliberation</h3>
                                                    {msg.timers?.stage1Start && (
                                                        <StageTimer
                                                            startTime={msg.timers.stage1Start}
                                                            endTime={msg.timers.stage1End}
                                                        />
                                                    )}
                                                </div>
                                                <CouncilGrid
                                                    models={councilModels} // Use the same models list
                                                    chairman={chairmanModel}
                                                    status={msg.loading?.stage1 ? 'thinking' : 'complete'}
                                                    progress={{
                                                        currentModel: msg.progress?.stage1?.currentModel,
                                                        completed: msg.stage1?.map(r => r.model) || []
                                                    }}
                                                />
                                            </div>
                                        )}

                                        {/* Stage 1 Results (Accordion/List - kept for detail view) */}
                                        {(msg.loading?.stage1 || (msg.stage1 && !msg.stage2)) ? (
                                            msg.loading?.stage1 && !msg.stage1 ? (
                                                <Stage1Skeleton />
                                            ) : msg.stage1 && (
                                                <Stage1
                                                    responses={msg.stage1}
                                                    startTime={msg.timers?.stage1Start}
                                                    endTime={msg.timers?.stage1End}
                                                />
                                            )
                                        ) : null}

                                        {/* Stage 2 */}
                                        {msg.loading?.stage2 && (
                                            <Stage2Skeleton />
                                        )}
                                        {msg.stage2 && (
                                            <Stage2
                                                rankings={msg.stage2}
                                                labelToModel={msg.metadata?.label_to_model}
                                                aggregateRankings={msg.metadata?.aggregate_rankings}
                                                startTime={msg.timers?.stage2Start}
                                                endTime={msg.timers?.stage2End}
                                            />
                                        )}

                                        {/* Stage 3 */}
                                        {msg.loading?.stage3 && (
                                            <Stage3Skeleton />
                                        )}
                                        {msg.stage3 && (
                                            <Stage3
                                                finalResponse={msg.stage3}
                                                startTime={msg.timers?.stage3Start}
                                                endTime={msg.timers?.stage3End}
                                            />
                                        )}

                                        {/* Aborted Indicator */}
                                        {msg.aborted && (
                                            <div className="aborted-indicator">
                                                <span className="aborted-icon">⏹</span>
                                                <span className="aborted-text">
                                                    Generation stopped by user.
                                                    {msg.stage1 && !msg.stage3 && ' Partial results shown above.'}
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))
                )}

                {/* Bottom Spacer for floating input */}
                <div ref={messagesEndRef} style={{ height: '20px' }} />
            </div>

            {/* Floating Command Capsule */}
            <div className="input-area">
                {!councilConfigured ? (
                    <div className="input-container config-required">
                        <span className="config-message">
                            ⚠️ Council not ready.
                            <button className="config-link" onClick={() => onOpenSettings('llm_keys')}>Configure API Keys</button>
                            <span className="config-separator">or</span>
                            <button className="config-link" onClick={() => onOpenSettings('council')}>Configure Council</button>
                        </span>
                    </div>
                ) : (
                    <form className="input-container" onSubmit={handleSubmit}>
                        {/* Hidden file input */}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            style={{ display: 'none' }}
                            accept=".pdf,.md,.markdown,.csv,.txt,.text"
                            disabled={isLoading || isUploading}
                        />
                        
                        {/* File preview - shown when file is uploaded */}
                        {uploadedFile && (
                            <div className="file-preview">
                                <FileIcon type={uploadedFile.type} />
                                <span className="file-name">{uploadedFile.name}</span>
                                <span className="file-size">({formatFileSize(uploadedFile.size)})</span>
                                <button 
                                    type="button" 
                                    className="file-remove-btn"
                                    onClick={handleFileRemove}
                                    disabled={isLoading}
                                    title="Remove file"
                                >
                                    ×
                                </button>
                            </div>
                        )}
                        
                        <div className="input-row-top">
                            <label className={`search-toggle ${webSearch ? 'active' : ''}`} title="Toggle Web Search">
                                <input
                                    type="checkbox"
                                    className="search-checkbox"
                                    checked={webSearch}
                                    onChange={() => setWebSearch(!webSearch)}
                                    disabled={isLoading}
                                />
                                <span className="search-icon">🌐</span>
                                {webSearch && <span className="search-label">Search On</span>}
                            </label>

                            {/* Upload button */}
                            <button
                                type="button"
                                className={`upload-button ${uploadedFile ? 'has-file' : ''} ${isUploading ? 'uploading' : ''}`}
                                onClick={triggerFileInput}
                                disabled={isLoading || isUploading}
                                title="Attach file (PDF, MD, CSV, TXT)"
                            >
                                {isUploading ? (
                                    <span className="upload-spinner">⏳</span>
                                ) : (
                                    <PaperclipIcon />
                                )}
                            </button>

                            <textarea
                                className="message-input"
                                placeholder={isLoading ? "Consulting..." : uploadedFile ? "Ask about the uploaded file..." : "Ask the Council..."}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={isLoading}
                                rows={1}
                                style={{ height: 'auto', minHeight: '24px' }}
                            />

                            {isLoading ? (
                                <button type="button" className="send-button stop-button" onClick={onAbort} title="Stop Generation">
                                    ⏹
                                </button>
                            ) : (
                                <button 
                                    type="submit" 
                                    className="send-button" 
                                    disabled={!input.trim() && !uploadedFile}
                                >
                                    ➤
                                </button>
                            )}
                        </div>

                        <div className="input-row-bottom">
                            <ExecutionModeToggle
                                value={executionMode}
                                onChange={onExecutionModeChange}
                                disabled={isLoading}
                            />
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
