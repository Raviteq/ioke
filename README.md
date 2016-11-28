# ioke
Image server with dynamic manipulation

*spirit of pursuit in battle*

# Install

# Usage

```
npm install ioke --save
```

```
var ioke = require('ioke');
app.use('/medias', ioke('my/images/dir', ioke.backend));
```

Now you can access your medias and crop/resize as needed:

```
example.com/medias/image1.jpg?w=100&h=100&x=10&y=35
```
