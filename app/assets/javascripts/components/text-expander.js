App.TextExpander = function(params) {
	this.container = params.container;
	this.maxLength = params.maxLength || 60;
	this.maxWords = params.maxWords; // word-count mode, takes priority over maxLength when set
	this.moreText = params.moreText || 'Show more';
	this.lessText = params.lessText || 'Show less';

	// Get original HTML, not just text, so <br> is preserved
	this.originalHtml = this.container.html().trim();
	this.originalText = this.container.text().trim(); // plain text length check

	if (this.maxWords) {
		this.words = this.originalText.split(/\s+/);
		if (this.words.length > this.maxWords) {
			this.truncatedText = this.words.slice(0, this.maxWords).join(' ') + '…';
			this.isTruncated = true;
			this.render();
		}
	} else if (this.originalText.length > this.maxLength) {
		this.truncatedText = this.originalText.substring(0, this.maxLength) + '…';
		this.isTruncated = true;
		this.render();
	}
};

App.TextExpander.prototype.render = function() {
	this.container.empty();

	this.textSpan = $('<span class="app-truncate__text"></span>').html(this.truncatedText);
	// A real button with aria-expanded, not a link — this toggles content
	// in place rather than navigating anywhere.
	this.toggleButton = $('<button type="button" class="app-truncate__link"></button>')
		.attr('aria-expanded', 'false')
		.text(this.moreText);

	this.container.append(this.textSpan).append(' ').append(this.toggleButton);

	this.toggleButton.on('click', $.proxy(this, 'onToggleClick'));
};

App.TextExpander.prototype.onToggleClick = function() {
	if (this.isTruncated) {
		this.textSpan.html(this.originalHtml);
		this.toggleButton.text(this.lessText).attr('aria-expanded', 'true');
		this.isTruncated = false;
	} else {
		this.textSpan.text(this.truncatedText);
		this.toggleButton.text(this.moreText).attr('aria-expanded', 'false');
		this.isTruncated = true;
	}
};
